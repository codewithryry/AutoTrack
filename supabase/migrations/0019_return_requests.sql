/* ------------------------------------------------------------------ *
 * 0019 — a student asks to hand a tool back; staff confirm it
 *
 * Three columns on `transactions`, and nothing else:
 *
 *   return_requested_at         when the borrower asked to hand the tool back
 *   return_request_condition    the condition they reported at that moment
 *   return_request_notes        anything they wrote with the request
 *
 * The transaction's own `status` is untouched by a request: the tool is still
 * out, still counted as borrowed, and the row only becomes `Returned` (or
 * `Damaged`) when a member of staff receives it at the crib — the existing
 * return path, unchanged. The check constraint on `status` therefore stays
 * exactly as it was, and every row written before this migration stays valid
 * with three nulls.
 *
 * The update policy gains one case: a borrower may stamp these three columns
 * on their own open loan while it stays open. Everything else about who may
 * write to a transaction is unchanged — finalising a return is still an
 * ordinary update, and the service refuses to run it for a student.
 * ------------------------------------------------------------------ */

alter table public.transactions
  add column if not exists return_requested_at timestamptz,
  add column if not exists return_request_condition text,
  add column if not exists return_request_notes text;

-- Open loans waiting on the counter, which is what the return desk lists.
create index if not exists transactions_return_requested_idx
  on public.transactions (return_requested_at)
  where return_requested_at is not null;

-- The same policy 0008 installed, restated so this migration stands on its own
-- on a database where 0008's version was never applied: a borrower may write to
-- their own loan while it is open, and the guard trigger below decides what.
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (
    public.is_staff()
    or (public.is_active() and user_id = auth.uid()::text
        and status in ('Borrowed', 'Overdue', 'Returned', 'Damaged'))
  );

-- What decides column by column is the guard trigger, and it
-- gains one more permitted write: stamping a return request on a loan that
-- stays open. Everything else in it is unchanged from 0008 — a borrower still
-- cannot move a loan, change its dates, or rewrite who issued or received it.
create or replace function public.transactions_guard_borrower_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;

  if new.user_id is distinct from old.user_id
     or new.tool_id is distinct from old.tool_id
     or new.due_date is distinct from old.due_date
     or new.borrow_date is distinct from old.borrow_date then
    raise exception 'A borrower may only close their own loan.' using errcode = '42501';
  end if;

  -- Closing the loan: as before. Staff are the ones who do this now, but the
  -- rule is left in place rather than tightened here.
  if new.status in ('Returned', 'Damaged') then
    return new;
  end if;

  -- Appending a location checkpoint to a loan that is still open (0008).
  if old.status in ('Borrowed', 'Overdue')
     and new.status = old.status
     and new.return_date          is not distinct from old.return_date
     and new.condition_in         is not distinct from old.condition_in
     and new.condition_out        is not distinct from old.condition_out
     and new.notes                is not distinct from old.notes
     and new.purpose              is not distinct from old.purpose
     and new.was_overdue          is not distinct from old.was_overdue
     and new.issued_by_id         is not distinct from old.issued_by_id
     and new.issued_by_name       is not distinct from old.issued_by_name
     and new.received_by_id       is not distinct from old.received_by_id
     and new.received_by_name     is not distinct from old.received_by_name
     and new.tool_name            is not distinct from old.tool_name
     and new.tool_category        is not distinct from old.tool_category
     and new.user_name            is not distinct from old.user_name
     and new.user_role            is not distinct from old.user_role
     and new.borrow_location      is not distinct from old.borrow_location
     and new.return_location      is not distinct from old.return_location
     and new.return_requested_at  is not distinct from old.return_requested_at
     and jsonb_array_length(new.location_checkpoints)
         = jsonb_array_length(old.location_checkpoints) + 1
     and new.location_checkpoints @> old.location_checkpoints then
    return new;
  end if;

  -- The one new case: asking for the return. The loan stays open and stays the
  -- borrower's own; only the three request columns are written, and only once —
  -- a loan that already carries a request cannot be re-stamped.
  if old.status in ('Borrowed', 'Overdue')
     and new.status = old.status
     and old.return_requested_at is null
     and new.return_requested_at is not null
     and new.return_date          is not distinct from old.return_date
     and new.condition_in         is not distinct from old.condition_in
     and new.condition_out        is not distinct from old.condition_out
     and new.notes                is not distinct from old.notes
     and new.purpose              is not distinct from old.purpose
     and new.was_overdue          is not distinct from old.was_overdue
     and new.issued_by_id         is not distinct from old.issued_by_id
     and new.issued_by_name       is not distinct from old.issued_by_name
     and new.received_by_id       is not distinct from old.received_by_id
     and new.received_by_name     is not distinct from old.received_by_name
     and new.tool_name            is not distinct from old.tool_name
     and new.tool_category        is not distinct from old.tool_category
     and new.user_name            is not distinct from old.user_name
     and new.user_role            is not distinct from old.user_role
     and new.borrow_location      is not distinct from old.borrow_location
     and new.return_location      is not distinct from old.return_location
     and new.location_checkpoints is not distinct from old.location_checkpoints then
    return new;
  end if;

  raise exception
    'A borrower may only close their own loan, request its return, or add a location checkpoint to it.'
    using errcode = '42501';
end;
$$;
