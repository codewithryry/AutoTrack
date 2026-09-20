/* ------------------------------------------------------------------ *
 * 0035 — fix "operator does not exist: uuid = text" in report_tool_problem
 *
 * `0034` declared `v_reporter_id` as text (`auth.uid()::text`) and then used
 * it for two different jobs: comparing against `profiles.id`, which is uuid,
 * and writing to `maintenance.created_by_id` / `activity_logs.user_id`, which
 * are text (business tables keep text ids — see the note atop `0001_schema.sql`).
 * The comparison at `where id = v_reporter_id` mixed the two: `profiles.id`
 * (uuid) has no `=` operator against text, so every submission failed with
 * "operator does not exist: uuid = text" before a single row was written.
 *
 * Fixed by keeping `auth.uid()` as uuid for the `profiles` lookup and deriving
 * the text form separately for the columns that are actually text. No column
 * type changes and no other behaviour changes — same validation, same
 * idempotency window, same notification and audit rows.
 * ------------------------------------------------------------------ */

create or replace function public.report_tool_problem(
  p_tool_id     text,
  p_type        text,
  p_description text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool           record;
  -- `auth.uid()` is a uuid, and so is `profiles.id` — kept as uuid for the
  -- lookup below. `v_reporter_id` is the text form everything else here wants:
  -- `maintenance.created_by_id` and `activity_logs.user_id` are both text
  -- columns, so only the comparison against `profiles.id` needs the uuid.
  v_reporter_uuid  uuid := auth.uid();
  v_reporter_id    text := v_reporter_uuid::text;
  v_reporter       record;
  v_id             text;
  v_notes          text;
begin
  -- Only a signed-in, active account. `is_active()` is the same gate every
  -- other policy uses, so a pending instructor is refused here too.
  if v_reporter_id is null or not public.is_active() then
    raise exception 'You are not allowed to report a problem.'
      using errcode = '42501';
  end if;

  select * into v_tool from public.tools where id = p_tool_id;
  if v_tool.id is null then
    raise exception 'That tool could not be found.' using errcode = 'P0002';
  end if;

  -- The type is constrained to the list the application already uses, so a
  -- report can never introduce a value the maintenance page cannot render.
  if p_type is null or p_type not in
     ('Preventive','Corrective','Calibration','Inspection','Cleaning','Parts Replacement') then
    raise exception 'Choose what kind of problem this is.' using errcode = '22023';
  end if;

  if p_description is null or btrim(p_description) = '' then
    raise exception 'Describe the problem.' using errcode = '22023';
  end if;
  if char_length(p_description) > 500 then
    raise exception 'Keep the description under 500 characters.' using errcode = '22023';
  end if;

  -- The fix: compare uuid to uuid, not uuid to text.
  select full_name, role into v_reporter from public.profiles where id = v_reporter_uuid;

  -- Who reported it is part of the record, written here rather than trusted
  -- from the caller.
  v_notes := 'Reported by ' || coalesce(nullif(v_reporter.full_name, ''), 'a user') ||
             ' (' || coalesce(v_reporter.role, 'Unknown') || '): ' || btrim(p_description);

  /* Idempotency, of the kind that matters here: a double-tapped submit, or a
     retry after a dropped connection, must not file the same report twice. An
     open report of the same type raised by the same person for the same tool in
     the last few minutes is treated as the same report, and its id is returned
     as if it had just been written. A genuinely new problem minutes later is
     rare; two rows from one tap is not. */
  select id into v_id
  from public.maintenance
  where tool_id = p_tool_id
    and type = p_type
    and status = 'Scheduled'
    and created_by_id = v_reporter_id
    and created_at > now() - interval '5 minutes'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  v_id := 'MNT-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.maintenance (
    id, tool_id, tool_name, type, technician, date, cost, notes, status,
    created_by_id, created_by_name, created_at, updated_at
  ) values (
    v_id, v_tool.id, v_tool.name, p_type, '', now(), 0, v_notes, 'Scheduled',
    v_reporter_id, coalesce(nullif(v_reporter.full_name, ''), ''), now(), now()
  );

  -- The laboratory's stream, so staff see it without anybody being addressed
  -- individually. `user_id` is null exactly as `templates.maintenanceDue` leaves
  -- it, which is what makes it a staff-visible notice rather than a personal one.
  insert into public.notifications (
    id, type, title, message, tool_id, tool_name, user_id, link, dedupe_key, created_at
  ) values (
    'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
    'maintenance',
    'Problem reported',
    v_tool.name || ' — ' || p_type || ' reported by ' ||
      coalesce(nullif(v_reporter.full_name, ''), 'a user') || '.',
    v_tool.id, v_tool.name, null, '/maintenance',
    -- Keyed to the report, so the alert follows the same one-per-event rule the
    -- rest of the notification table does.
    'problem-reported:' || v_id,
    now()
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  -- The audit trail, alongside every other tool event.
  insert into public.activity_logs (
    id, action, tool_id, tool_name, user_id, user_name, message, created_at
  ) values (
    'LOG-' || replace(gen_random_uuid()::text, '-', ''),
    'maintenance_scheduled', v_tool.id, v_tool.name,
    v_reporter_id, coalesce(nullif(v_reporter.full_name, ''), ''),
    'Reported a problem (' || p_type || ').',
    now()
  );

  return v_id;
end $$;

comment on function public.report_tool_problem is
  'Files a corrective maintenance record and notifies staff. The only route by '
  'which a non-staff account may write to maintenance, and it fixes every field '
  'except the tool, the type and the description.';

-- Unchanged from 0034: any signed-in account may call it; the function itself
-- decides whether the caller is active and what it will write on their behalf.
revoke all on function public.report_tool_problem(text, text, text) from public;
revoke all on function public.report_tool_problem(text, text, text) from anon;
grant execute on function public.report_tool_problem(text, text, text) to authenticated;
