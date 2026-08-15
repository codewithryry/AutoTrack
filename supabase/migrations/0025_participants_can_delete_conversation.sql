-- Anybody in a thread may delete it.
--
-- Removing a conversation used to be an administrator's action alone. It is now
-- the same right membership already carries everywhere else in messaging: the
-- people in a thread own it, so any of them may close it — a student clearing an
-- old exchange with the crib, an instructor tidying a finished request, an
-- administrator either.
--
-- It is a shared row, so this is a deletion for everyone in the thread and not a
-- private "hide it from my inbox" — the interface says exactly that before it
-- asks. Membership is still the whole boundary: `in_conversation()` refuses a
-- thread the caller is not part of, which is the same test the read policy uses,
-- so nobody gains sight of, or a hand on, a conversation they could not already
-- open.
--
-- The standing rooms are not affected. Their membership is the role, so
-- `in_conversation()` is true for everyone with it; the application refuses to
-- delete them because the general and staff rooms are expected to exist, and
-- `services/messages.js` is where that rule lives.

drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations
  for delete to authenticated
  using (public.is_admin() or public.in_conversation(id));

-- The messages go with the thread through `on delete cascade`, which does not
-- consult policies at all. This is for the direct removals the application makes
-- alongside it, and it is the same membership test.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (public.is_admin() or public.in_conversation(conversation_id));
