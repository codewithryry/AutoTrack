-- Students can start a conversation with the crib.
--
-- Messaging already lets anyone talk inside a thread they are a participant of,
-- but opening a *new* thread means naming the other person, and until now a
-- student could read no profile but their own. So the select policy gains one
-- more case: a profile of any role is readable by any signed-in account, which
-- is what makes the directory behind "new conversation" work for everybody.
--
-- Reading only. Insert, update, delete and the privileged-column guard are all
-- untouched, so nobody gains the ability to change a profile that is not their
-- own.

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_staff()
    or role in ('Admin', 'Instructor', 'Student')
  );