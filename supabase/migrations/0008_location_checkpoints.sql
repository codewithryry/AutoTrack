/* ------------------------------------------------------------------ *
 * 0008 — where a tool was handed over, and where it was used
 *
 * Three columns on `transactions`, and nothing else:
 *
 *   borrow_location       one point, captured when the loan was opened
 *   return_location       one point, captured when the loan was closed
 *   location_checkpoints  an append-only list of points the borrower chose to
 *                         record while the tool was still out
 *
 * These are *events*, not a track. Each entry is a single reading the user
 * explicitly asked for, stamped with the moment it was taken:
 *
 *   { "lat": 12.7, "lng": 121.4, "accuracy": 18.4, "capturedAt": "…Z",
 *     "capturedById": "…", "capturedByName": "…", "note": "" }
 *
 * Nothing in the application writes these on a timer or in the background, and
 * there is no column here that could hold a path between two of them. A reading
 * says where the tool was at that timestamp and says nothing about any other
 * moment — the UI is worded the same way.
 *
 * Existing rows get an empty checkpoint list and null borrow/return points, so
 * every loan written before this migration stays valid and readable.
 * ------------------------------------------------------------------ */

alter table public.transactions
  add column if not exists borrow_location      jsonb,
  add column if not exists return_location      jsonb,
  add column if not exists location_checkpoints jsonb not null default '[]'::jsonb;

-- A list, and a short one: the checkpoint action is manual, so a long list means
-- something is wrong. The cap is what stops a compromised client turning an
-- append-only column into unbounded storage.
alter table public.transactions
  drop constraint if exists transactions_checkpoints_shape;
alter table public.transactions
  add constraint transactions_checkpoints_shape
  check (
    jsonb_typeof(location_checkpoints) = 'array'
    and jsonb_array_length(location_checkpoints) <= 100
  );

/* ------------------------------------------------------------------ *
 * Borrower writes
 *
 * Before this migration a borrower could only ever update their own loan into
 * `Returned` or `Damaged` — the policy said so in its WITH CHECK, which is why
 * a checkpoint on an open loan was refused.
 *
 * The permission model is unchanged: a student still may not extend a due date,
 * reassign a loan, change a tool or edit anybody else's record. What moves is
 * *where* that is enforced. The policy now admits the borrower's own open loan,
 * and the guard trigger below — which, unlike a policy, can compare OLD to NEW —
 * decides column by column. The set of writes a borrower can actually perform
 * grows by exactly one: appending a single entry to `location_checkpoints`.
 * ------------------------------------------------------------------ */

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (
    public.is_staff()
    or (public.is_active() and user_id = auth.uid()::text
        and status in ('Borrowed', 'Overdue', 'Returned', 'Damaged'))
  );

create or replace function public.transactions_guard_borrower_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;

  -- Unchanged from 0002: a borrower may never move a loan onto another person,
  -- another tool, or another set of dates.
  if new.user_id is distinct from old.user_id
     or new.tool_id is distinct from old.tool_id
     or new.due_date is distinct from old.due_date
     or new.borrow_date is distinct from old.borrow_date then
    raise exception 'A borrower may only close their own loan.' using errcode = '42501';
  end if;

  -- Closing the loan: exactly as before, including the return point captured
  -- with it.
  if new.status in ('Returned', 'Damaged') then
    return new;
  end if;

  -- The one new case: appending a checkpoint to a loan that is still open.
  -- Every other column must be identical, the list may only grow by one, and it
  -- must still contain everything it contained before — so a borrower can add a
  -- reading but never rewrite or delete one.
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
     and jsonb_array_length(new.location_checkpoints)
         = jsonb_array_length(old.location_checkpoints) + 1
     and new.location_checkpoints @> old.location_checkpoints then
    return new;
  end if;

  raise exception
    'A borrower may only close their own loan or add a location checkpoint to it.'
    using errcode = '42501';
end;
$$;

drop trigger if exists transactions_borrower_guard on public.transactions;
create trigger transactions_borrower_guard before update on public.transactions
  for each row execute function public.transactions_guard_borrower_update();
