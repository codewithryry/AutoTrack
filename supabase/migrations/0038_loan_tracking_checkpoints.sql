/* ------------------------------------------------------------------ *
 * 0038 — automatic checkpoints from the Android app, written safely
 *
 * The Android app now records the borrower's phone location as a checkpoint
 * while a loan is open (every 10 minutes at most, and whenever the phone has
 * moved significantly). Those points go into the column `0008` already has —
 * `transactions.location_checkpoints` — in the shape it already uses:
 *
 *   { "lat", "lng", "accuracy", "capturedAt", "capturedById", "capturedByName" }
 *
 * No new table and no new column. What this migration adds is the one thing the
 * existing write path could not guarantee: that a checkpoint is never stored on
 * a loan that has already closed.
 *
 * The existing path is read-modify-write from the client — read the loan, check
 * it is open, write the whole array back. Two gaps follow from that:
 *
 *   1. A return confirmed between the read and the write still lets the write
 *      through, because the guard trigger admits any borrower update whose new
 *      status is 'Returned' / 'Damaged' — and a patch that only names
 *      `location_checkpoints` carries the (now closed) status forward
 *      unchanged. A queued point synced after a return would land on the
 *      closed loan.
 *   2. Every check lives in the browser.
 *
 * Both are closed here:
 *
 *   • `append_loan_checkpoint()` does the whole append inside the database. It
 *     locks the loan row, and only then checks, in order: a signed-in active
 *     account, the loan exists, the caller is its borrower, the loan is still
 *     Borrowed/Overdue, the reading is sane, it is not a duplicate, and the
 *     `0008` cap of 100 is not reached. The lock serialises it against the
 *     staff update that closes the loan, so a return and a checkpoint arriving
 *     together can never both win.
 *
 *     The capturer is taken from `auth.uid()` and the profile, never from the
 *     caller. It answers with a status rather than an error for the outcomes
 *     the tracker must act on ('closed' means stop tracking, 'duplicate' means
 *     the point was already synced once).
 *
 *   • `transactions_guard_closed_checkpoints` refuses, for non-staff, any change
 *     to `location_checkpoints` on a loan that is no longer open — whichever
 *     path the write takes.
 *
 * `0008`'s guard trigger is not redefined: the append performed here is exactly
 * the "one more entry, nothing else changed" case it already admits, so the
 * borrower rules stay in one place.
 * ------------------------------------------------------------------ */

create or replace function public.append_loan_checkpoint(
  p_transaction_id text,
  p_lat            double precision,
  p_lng            double precision,
  p_accuracy       double precision,
  p_captured_at    timestamptz,
  p_note           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     text := auth.uid()::text;
  v_txn     public.transactions%rowtype;
  v_name    text;
  v_stamp   text;
  v_point   jsonb;
  v_count   integer;
begin
  if v_uid is null or not public.is_active() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- The row lock is the point of this function: a staff return that is in
  -- flight either commits first (and this sees the closed status) or waits for
  -- this append to finish.
  select * into v_txn from public.transactions where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  -- Only the borrower's own phone records where their tool is. Staff correct a
  -- loan through the ordinary update path, not through this one.
  if v_txn.user_id is distinct from v_uid then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_txn.status not in ('Borrowed', 'Overdue') then
    return jsonb_build_object('status', 'closed');
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_accuracy is not null and (p_accuracy < 0 or p_accuracy > 1000000))
     or p_captured_at is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- A reading from the future, or from before the loan existed, does not belong
  -- to it. Fifteen minutes of slack either side absorbs a phone clock that has
  -- drifted.
  if p_captured_at > now() + interval '15 minutes'
     or p_captured_at < v_txn.borrow_date - interval '15 minutes' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- The same text JavaScript's `toISOString()` produces, so a point written here
  -- and a point written by the older client path compare equal, and so a queued
  -- point that is synced twice is recognised as the same point.
  v_stamp := to_char(p_captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_txn.location_checkpoints @> jsonb_build_array(jsonb_build_object('capturedAt', v_stamp)) then
    return jsonb_build_object(
      'status', 'duplicate',
      'count', jsonb_array_length(v_txn.location_checkpoints)
    );
  end if;

  v_count := jsonb_array_length(v_txn.location_checkpoints);
  if v_count >= 100 then
    return jsonb_build_object('status', 'full', 'count', v_count);
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  v_point := jsonb_build_object(
    'lat', round(p_lat::numeric, 6),
    'lng', round(p_lng::numeric, 6),
    'accuracy', case when p_accuracy is null then null else round(p_accuracy::numeric, 1) end,
    'capturedAt', v_stamp,
    'capturedById', v_uid,
    'capturedByName', coalesce(v_name, v_txn.user_name)
  );
  if p_note is not null and btrim(p_note) <> '' then
    v_point := v_point || jsonb_build_object('note', left(btrim(p_note), 200));
  end if;

  update public.transactions
     set location_checkpoints = location_checkpoints || jsonb_build_array(v_point),
         updated_at = now()
   where id = v_txn.id;

  return jsonb_build_object('status', 'saved', 'count', v_count + 1);
end;
$$;

revoke all on function public.append_loan_checkpoint(text, double precision, double precision, double precision, timestamptz, text) from public, anon;
grant execute on function public.append_loan_checkpoint(text, double precision, double precision, double precision, timestamptz, text) to authenticated;

/* ------------------------------------------------------------------ *
 * No checkpoint changes on a closed loan, by any path
 * ------------------------------------------------------------------ */

create or replace function public.transactions_guard_closed_checkpoints()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;

  if old.status not in ('Borrowed', 'Overdue')
     and new.location_checkpoints is distinct from old.location_checkpoints then
    raise exception 'This loan is closed, so its location can no longer be updated.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_closed_checkpoints_guard on public.transactions;
create trigger transactions_closed_checkpoints_guard before update on public.transactions
  for each row execute function public.transactions_guard_closed_checkpoints();
