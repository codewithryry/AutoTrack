-- Two standing threads, alongside the direct and request ones.
--
--   general  every signed-in account reads it and may reply — the laboratory's
--            noticeboard, but a conversation rather than an announcement.
--   staff    the crib's own room: instructors and administrators only. A
--            student cannot read it, so there is nothing for them to reply to.
--
-- Membership is what every messaging policy already tests, so rather than
-- writing a participant row for every account in the system, `in_conversation`
-- learns about these two rooms. Every policy written against it — reading a
-- thread, reading its messages, posting into it — then follows without change.

alter table public.conversations
  drop constraint if exists conversations_kind_check;

alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('direct', 'request', 'general', 'staff'));

-- The two rooms themselves. Fixed ids, so the application can open them by name.
insert into public.conversations (id, kind, subject, created_by)
values
  ('CNV-GENERAL', 'general', 'General', 'system'),
  ('CNV-STAFF',   'staff',   'Staff room', 'system')
on conflict (id) do update
  set kind = excluded.kind, subject = excluded.subject;

-- Membership, now including the two standing rooms.
create or replace function public.in_conversation(cid text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select
    exists (
      select 1 from public.conversation_participants p
      where p.conversation_id = cid and p.user_id = auth.uid()::text
    )
    or exists (
      select 1 from public.conversations c
      where c.id = cid
        and (
          (c.kind = 'general' and public.is_active())
          or (c.kind = 'staff' and public.is_staff())
        )
    )
$$;

grant execute on function public.in_conversation(text) to authenticated;
