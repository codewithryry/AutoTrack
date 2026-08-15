-- Opening a conversation refused itself.
--
-- A thread is readable through membership, and the participant rows are written
-- immediately after the conversation row. But the insert reads the new row back
-- (PostgREST's `insert ... returning`), and at that instant the creator is not
-- yet a participant of their own thread — so `conversations_select` refused the
-- read and the whole "new conversation" failed with 42501.
--
-- The creator is added as a participant a statement later, so naming them here
-- widens nothing in practice: it only lets the row that was just written be
-- read back by the account that wrote it.

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (public.in_conversation(id) or created_by = auth.uid()::text);
