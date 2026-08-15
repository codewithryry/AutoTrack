/**
 * 0018 — the borrower may close their own approved hold
 *
 * An approved request leaves a reservation behind, and collecting the tool is
 * what turns that hold into a loan. The student the tool was approved for is
 * allowed to take it out themselves (`transactions_insert` in `0002` already
 * says so), so they must also be able to stamp their own hold as collected.
 *
 * Nothing else changes: a hold is still only ever created by staff, still only
 * readable by staff and the person it is for, and a student still cannot touch
 * anybody else's row — the only new value they may write is `Fulfilled` on
 * their own.
 */

drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (
    public.is_staff()
    or (user_id = auth.uid()::text and status in ('Cancelled', 'Fulfilled'))
  );
