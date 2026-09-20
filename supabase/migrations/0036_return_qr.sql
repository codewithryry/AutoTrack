/* ------------------------------------------------------------------ *
 * 0036 — a QR code for the return request `0019` already has
 *
 * `0019` gave a borrower a way to say "I'm handing this back" without closing
 * the loan themselves — `return_requested_at` on the transaction, confirmed at
 * the counter through the existing `returnTool()` path. This migration adds
 * what that flow was missing: a scannable, opaque token for the request, and
 * three outcomes for staff to record once they have physically inspected the
 * tool, instead of the single close-out `returnTool()` always ran.
 *
 * No new table. A return request is still a transaction in `Borrowed` or
 * `Overdue` with `return_requested_at` set — this only adds the columns that
 * outcome needs:
 *
 *   return_qr_token          opaque, unique, printable/scannable — never the
 *                             transaction id itself, so a QR code cannot be
 *                             turned into a lookup key for the loan by anyone
 *                             who merely sees it
 *   return_decision           'accepted' | 'accepted_with_issue' | 'rejected'
 *   return_issue_type         set only when accepted with an issue
 *   return_rejection_reason   set only when rejected
 *   return_processed_at       when staff decided it
 *   return_processed_by_id    who did — a profile id, kept as text like every
 *   return_processed_by_name  other actor pointer on this table
 *
 * A rejection does not close the loan: `return_requested_at` and
 * `return_qr_token` are cleared so the borrower can ask again, and the
 * transaction's own `status` stays `Borrowed`/`Overdue` exactly as `0019`
 * already left it while a request was outstanding. `status` only becomes
 * `Returned`/`Damaged` on Accept or Accept-with-issue, through the same
 * `transactions_update` policy and the same staff-only path `returnTool()`
 * already used — nothing about who may close a loan changes here.
 *
 * No guard-trigger change: `transactions_guard_borrower_update()` only runs
 * for a borrower's own write (`if public.is_staff() then return new;` is its
 * first line), and every column this migration adds is written by staff
 * deciding a scanned or manually opened request, never by the borrower who
 * requested it. The borrower path — requesting a return, and now getting a
 * token back — already passes the trigger's existing "stamp a return request"
 * case, since that case does not enumerate `return_qr_token` and the
 * unmentioned column is therefore free for the same write to also set.
 * Restated here for that reason: the trigger must keep allowing
 * `return_qr_token` to change alongside `return_requested_at` on a borrower's
 * own request.
 * ------------------------------------------------------------------ */

alter table public.transactions
  add column if not exists return_qr_token           text,
  add column if not exists return_decision            text
                          check (return_decision in ('accepted','accepted_with_issue','rejected')),
  add column if not exists return_issue_type          text,
  add column if not exists return_rejection_reason    text,
  add column if not exists return_processed_at        timestamptz,
  add column if not exists return_processed_by_id     text,
  add column if not exists return_processed_by_name   text;

-- The scanner's one lookup: token -> transaction. Unique so a token can never
-- resolve two different requests, and partial so closed loans (token cleared
-- on rejection, left in place but harmless once decided) do not bloat it.
create unique index if not exists transactions_return_qr_token_key
  on public.transactions (return_qr_token)
  where return_qr_token is not null;

-- The counter's queue, and the manual "find a return request" fallback both
-- read this shape: still open, still waiting.
create index if not exists transactions_return_decision_idx
  on public.transactions (return_decision)
  where return_decision is not null;

-- The guard trigger from `0019`, restated with `return_qr_token` added to the
-- "stamping a return request" case's unchanged-columns list turned into an
-- allowed-to-change entry. Every other case, and every other column, is
-- exactly what `0019` left it as.
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
     and new.return_qr_token      is not distinct from old.return_qr_token
     and jsonb_array_length(new.location_checkpoints)
         = jsonb_array_length(old.location_checkpoints) + 1
     and new.location_checkpoints @> old.location_checkpoints then
    return new;
  end if;

  -- The one new case: asking for the return. The loan stays open and stays the
  -- borrower's own; only the request columns are written, and only once — a
  -- loan that already carries a request cannot be re-stamped. `return_qr_token`
  -- is generated in the same write as `return_requested_at`, so it is listed
  -- here as changing rather than held fixed.
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
     and new.location_checkpoints is not distinct from old.location_checkpoints
     and new.return_decision            is not distinct from old.return_decision
     and new.return_issue_type          is not distinct from old.return_issue_type
     and new.return_rejection_reason    is not distinct from old.return_rejection_reason
     and new.return_processed_at        is not distinct from old.return_processed_at
     and new.return_processed_by_id     is not distinct from old.return_processed_by_id
     and new.return_processed_by_name   is not distinct from old.return_processed_by_name then
    return new;
  end if;

  raise exception
    'A borrower may only close their own loan, request its return, or add a location checkpoint to it.'
    using errcode = '42501';
end;
$$;
