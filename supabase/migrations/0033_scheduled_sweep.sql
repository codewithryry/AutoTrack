-- The overdue and maintenance sweep, runnable without a browser.
--
-- Until now `runOverdueCheck()` and `notifyDue()` ran only from `AppContext`,
-- and only for a signed-in *staff* account. If no instructor or administrator
-- opened ToolTrack over a weekend, no loan flipped to `Overdue`, nobody was
-- told a tool was late, and no maintenance date raised an alert. The work was
-- correct; it simply depended on somebody being there to trigger it.
--
-- This is the same sweep, expressed where it can run on a schedule. It is
-- deliberately a database function rather than a second copy of the logic in
-- JavaScript: the notification wording and, more importantly, the `dedupe_key`
-- strings have to match `services/notifications.js` exactly, and two
-- implementations of the same key would eventually drift and start posting
-- duplicates. One place, one set of keys.
--
-- Idempotent by construction:
--   • a loan is only flipped when its status is not already `Overdue`
--   • a tool is only flipped when its status is not already `Overdue`
--   • every notification insert is `on conflict do nothing` against the
--     `dedupe_key`, which is exactly what `notifications.create()` does in JS
-- Running it ten times in a row has the same effect as running it once.
--
-- The client-side sweep in `AppContext` is left exactly as it is. It keeps a
-- staff member's screen fresh the moment they open the app; this keeps the
-- records correct when nobody does.

-- `dedupe_key` is the idempotency key the `on conflict` clauses below rely on.
-- The partial unique index they need — `notifications_dedupe_key` — was
-- already created in 0001_schema.sql and has stood since the table's first
-- migration, so there is nothing to add here: Postgres has refused a
-- duplicate `dedupe_key` from day one, and no row in this table can already
-- violate it.
--
-- An earlier draft of this migration re-created that same constraint under a
-- second name and, believing it was needed, deleted every row it considered a
-- "pre-existing duplicate" to make room for it. Both steps were wrong: the
-- index already existed, so the constraint it was building for was never
-- missing, and the delete would have been removing history that was never in
-- conflict with anything — a destructive statement earning its keep from a
-- false premise. Neither step ran against production; caught in review.
-- Recorded here, not silently dropped, so the mistake stays legible in the
-- migration history rather than disappearing as if it had never been drafted.

create or replace function public.run_scheduled_sweep(
  due_soon_threshold_days integer default 1,
  notify_overdue boolean default true,
  notify_maintenance boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  loan            record;
  tool            record;
  overdue_count   integer := 0;
  due_soon_count  integer := 0;
  maintenance_cnt integer := 0;
begin
  ------------------------------------------------------------------
  -- Loans that are past their due date
  ------------------------------------------------------------------
  for loan in
    select t.*
    from public.transactions t
    where t.status in ('Borrowed', 'Overdue')
      and t.due_date < now()
  loop
    overdue_count := overdue_count + 1;

    select * into tool from public.tools where id = loan.tool_id;

    -- The loan record. Only written when it has not already been flipped, so a
    -- repeat run touches nothing and `updated_at` does not churn.
    if loan.status <> 'Overdue' then
      update public.transactions
         set status = 'Overdue', updated_at = now()
       where id = loan.id;

      if tool.id is not null then
        insert into public.activity_logs (id, action, tool_id, tool_name, user_id, user_name,
                                          transaction_id, message, created_at)
        values (
          'LOG-' || replace(gen_random_uuid()::text, '-', ''),
          'tool_overdue', tool.id, tool.name, loan.user_id, loan.user_name, loan.id,
          'Tool became overdue — it was due on ' ||
            to_char(loan.due_date, 'FMMonth FMDD, YYYY') || '.',
          now()
        );
      end if;
    end if;

    -- The tool record follows the loan, even if the two had drifted apart.
    if tool.id is not null and tool.status <> 'Overdue' then
      update public.tools set status = 'Overdue', updated_at = now() where id = tool.id;
    end if;

    -- Two alerts, as in `services/notifications.js`: one for the laboratory's
    -- stream and one addressed to the borrower. Same wording, same keys.
    if notify_overdue and tool.id is not null then
      insert into public.notifications (id, type, title, message, tool_id, tool_name,
                                        transaction_id, user_id, link, dedupe_key, created_at)
      values (
        'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
        'overdue', 'Tool overdue',
        tool.name || ' has not been returned. Borrowed by ' ||
          coalesce(nullif(loan.user_name, ''), 'a user') || '.',
        tool.id, tool.name, loan.id, null, '/tools/' || tool.id,
        'overdue:' || loan.id, now()
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;

      if loan.user_id is not null and loan.user_id <> '' then
        insert into public.notifications (id, type, title, message, tool_id, tool_name,
                                          transaction_id, user_id, link, dedupe_key, created_at)
        values (
          'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
          'overdue', 'Your tool is overdue',
          tool.name || ' was due back on ' || to_char(loan.due_date, 'FMMonth FMDD') ||
            '. Please return it.',
          tool.id, tool.name, loan.id, loan.user_id, '/tools/' || tool.id,
          'overdue:' || loan.id || ':' || loan.user_id, now()
        )
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Loans due within the threshold, but not yet late
  ------------------------------------------------------------------
  for loan in
    select t.*
    from public.transactions t
    where t.status in ('Borrowed', 'Overdue')
      and t.due_date >= now()
      and t.due_date < now() + make_interval(days => greatest(due_soon_threshold_days, 0))
  loop
    due_soon_count := due_soon_count + 1;

    if notify_overdue then
      select * into tool from public.tools where id = loan.tool_id;
      if tool.id is not null then
        insert into public.notifications (id, type, title, message, tool_id, tool_name,
                                          transaction_id, user_id, link, dedupe_key, created_at)
        values (
          'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
          'due_soon', 'Tool due soon',
          tool.name || ' is due back on ' || to_char(loan.due_date, 'FMMonth FMDD') || '.',
          tool.id, tool.name, loan.id, loan.user_id, '/tools/' || tool.id,
          'due-soon:' || loan.id, now()
        )
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Tools past their scheduled service date
  ------------------------------------------------------------------
  if notify_maintenance then
    for tool in
      select *
      from public.tools
      where next_maintenance_date is not null
        and next_maintenance_date <= now()
        and status <> 'Retired'
        and status <> 'Maintenance'
    loop
      maintenance_cnt := maintenance_cnt + 1;

      insert into public.notifications (id, type, title, message, tool_id, tool_name,
                                        link, dedupe_key, created_at)
      values (
        'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
        'maintenance', 'Maintenance due',
        tool.name || ' has reached its scheduled maintenance date.',
        tool.id, tool.name, '/tools/' || tool.id,
        -- The service date is part of the key, so rescheduling raises a new
        -- alert while the same date never raises a second one.
        --
        -- Only the calendar date is used, deliberately. The JavaScript path
        -- interpolates whatever timestamp string Supabase returned, and that
        -- rendering is not guaranteed to match what `to_char` produces here —
        -- a mismatch would mean the two paths disagreed about the key and
        -- posted the alert twice. A date has one unambiguous spelling, and a
        -- service is not scheduled twice in one day, so nothing is lost.
        'maintenance-due:' || tool.id || ':' ||
          to_char(tool.next_maintenance_date, 'YYYY-MM-DD'),
        now()
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end loop;
  end if;

  return jsonb_build_object(
    'overdue', overdue_count,
    'dueSoon', due_soon_count,
    'maintenance', maintenance_cnt,
    'sweptAt', now()
  );
end $$;

comment on function public.run_scheduled_sweep is
  'Flips due loans to Overdue and raises overdue/due-soon/maintenance alerts. '
  'Idempotent. Called by api/sweep.js on a schedule so the records stay correct '
  'when nobody opens the app.';

-- The function runs as its owner, so it is not callable by a signed-in browser
-- session: only the service role reaches it, from the scheduled endpoint. This
-- is deliberate — the client already has `runOverdueCheck()` for its own
-- freshness, and that path is still governed by RLS as before.
revoke all on function public.run_scheduled_sweep(integer, boolean, boolean) from public;
revoke all on function public.run_scheduled_sweep(integer, boolean, boolean) from anon;
revoke all on function public.run_scheduled_sweep(integer, boolean, boolean) from authenticated;
