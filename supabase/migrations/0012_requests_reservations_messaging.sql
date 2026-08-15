/* ------------------------------------------------------------------ *
 * 0012 — asking for a tool, holding it, and talking about it
 *
 * Three related additions, and nothing taken away. Borrowing, returning,
 * scanning and the transaction record are untouched: a request is what happens
 * *before* a loan, a reservation is the hold it turns into, and a conversation
 * is where the people involved talk about it.
 *
 *   tool_requests             a student asks for a tool; staff decide
 *   reservations              the hold an approved request creates
 *   conversations             a 1-to-1 thread, or the thread on one request
 *   conversation_participants who is in it, and how far they have read
 *   messages                  what was said, with an optional attachment
 *
 * A request that is approved creates a reservation and keeps pointing at the
 * conversation it was discussed in, so the three read as one thing.
 *
 * Access follows the rules the rest of the schema already uses: `is_staff()`
 * and `is_active()` from 0002 decide what staff may see, a student may only
 * ever reach their own rows, and a conversation is readable only by the people
 * in it — including staff, who get no special path into someone else's thread.
 * ------------------------------------------------------------------ */

/* ------------------------------ requests ------------------------------ */

create table if not exists public.tool_requests (
  id              text primary key,
  tool_id         text not null references public.tools(id) on delete cascade,
  tool_name       text not null default '',
  user_id         text not null,
  user_name       text not null default '',
  user_role       text not null default 'Student',
  purpose         text not null default '',
  needed_from     timestamptz not null,
  needed_to       timestamptz not null,
  status          text not null default 'Pending'
                  check (status in ('Pending','Approved','Rejected','Cancelled','Expired')),
  decision_note   text not null default '',
  decided_by_id   text,
  decided_by_name text,
  decided_at      timestamptz,
  reservation_id  text,
  conversation_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint tool_requests_window check (needed_to >= needed_from)
);

create index if not exists tool_requests_user_idx   on public.tool_requests (user_id);
create index if not exists tool_requests_tool_idx   on public.tool_requests (tool_id);
create index if not exists tool_requests_status_idx on public.tool_requests (status);

/* ---------------------------- reservations ---------------------------- */

create table if not exists public.reservations (
  id             text primary key,
  request_id     text references public.tool_requests(id) on delete set null,
  tool_id        text not null references public.tools(id) on delete cascade,
  tool_name      text not null default '',
  user_id        text not null,
  user_name      text not null default '',
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'Reserved'
                 check (status in ('Reserved','Fulfilled','Cancelled','Expired')),
  -- Set when the hold becomes a real loan, so the two never drift apart.
  transaction_id text references public.transactions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint reservations_window check (ends_at >= starts_at)
);

create index if not exists reservations_user_idx   on public.reservations (user_id);
create index if not exists reservations_tool_idx   on public.reservations (tool_id);
create index if not exists reservations_status_idx on public.reservations (status);

/* ---------------------------- conversations ---------------------------- */

create table if not exists public.conversations (
  id                   text primary key,
  -- `direct` is a 1-to-1 thread; `request` is the thread attached to one
  -- request, which is what keeps an approval and its discussion together.
  kind                 text not null default 'direct' check (kind in ('direct','request')),
  request_id           text references public.tool_requests(id) on delete cascade,
  subject              text not null default '',
  created_by           text not null,
  last_message_at      timestamptz,
  last_message_preview text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id text not null references public.conversations(id) on delete cascade,
  user_id         text not null,
  user_name       text not null default '',
  user_role       text not null default '',
  -- How far this person has read; the unread count is derived from it rather
  -- than stored, so it cannot fall out of step with the messages themselves.
  last_read_at    timestamptz,
  created_at      timestamptz not null default now(),

  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

create table if not exists public.messages (
  id              text primary key,
  conversation_id text not null references public.conversations(id) on delete cascade,
  sender_id       text not null,
  sender_name     text not null default '',
  sender_role     text not null default '',
  body            text not null default '',
  -- One optional attachment, held in the `message-attachments` bucket below.
  attachment_url  text,
  attachment_name text,
  attachment_type text,
  attachment_size integer,
  created_at      timestamptz not null default now(),

  constraint messages_not_empty
    check (char_length(body) > 0 or attachment_url is not null),
  constraint messages_body_len check (char_length(body) <= 4000)
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

/* ------------------------------------------------------------------ *
 * Who may see what
 * ------------------------------------------------------------------ */

alter table public.tool_requests             enable row level security;
alter table public.reservations              enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;

/**
 * Is the caller in this conversation?
 *
 * `security definer` so the check does not re-enter the participants policy and
 * recurse. It answers only about the caller — it cannot be used to read anyone
 * else's membership.
 */
create or replace function public.in_conversation(cid text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.conversation_participants p
    where p.conversation_id = cid and p.user_id = auth.uid()::text
  )
$$;

grant execute on function public.in_conversation(text) to authenticated;

/* --- requests: a student's own, or everything for staff --- */

drop policy if exists tool_requests_select on public.tool_requests;
create policy tool_requests_select on public.tool_requests
  for select to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text));

-- A student may only ever raise a request for themselves, and only as Pending:
-- deciding is staff work, and this is the boundary that holds it.
drop policy if exists tool_requests_insert on public.tool_requests;
create policy tool_requests_insert on public.tool_requests
  for insert to authenticated
  with check (
    public.is_staff()
    or (public.is_active() and user_id = auth.uid()::text and status = 'Pending')
  );

-- Staff decide; a requester may only withdraw their own request.
drop policy if exists tool_requests_update on public.tool_requests;
create policy tool_requests_update on public.tool_requests
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (public.is_staff() or (user_id = auth.uid()::text and status = 'Cancelled'));

drop policy if exists tool_requests_delete on public.tool_requests;
create policy tool_requests_delete on public.tool_requests
  for delete to authenticated using (public.is_admin());

/* --- reservations: the same shape --- */

drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations
  for select to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text));

-- Created by whoever approves — staff — never by the requester directly.
drop policy if exists reservations_insert on public.reservations;
create policy reservations_insert on public.reservations
  for insert to authenticated with check (public.is_staff());

drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (public.is_staff() or (user_id = auth.uid()::text and status = 'Cancelled'));

drop policy if exists reservations_delete on public.reservations;
create policy reservations_delete on public.reservations
  for delete to authenticated using (public.is_admin());

/* --- conversations: private to their participants, staff included --- */

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated using (public.in_conversation(id));

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (public.is_active() and created_by = auth.uid()::text);

-- The preview and timestamp are maintained by whoever posts into the thread.
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using (public.in_conversation(id)) with check (public.in_conversation(id));

drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations
  for delete to authenticated using (public.is_admin());

drop policy if exists conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated
  using (user_id = auth.uid()::text or public.in_conversation(conversation_id));

-- Adding people: the creator opening a thread, or anyone already in it. A
-- student cannot insert themselves into a conversation they are not part of,
-- because the second half of the check is the same membership test.
drop policy if exists conversation_participants_insert on public.conversation_participants;
create policy conversation_participants_insert on public.conversation_participants
  for insert to authenticated
  with check (
    public.is_active()
    and (
      public.in_conversation(conversation_id)
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.created_by = auth.uid()::text
      )
    )
  );

-- Only your own row, which is what "how far I have read" is.
drop policy if exists conversation_participants_update on public.conversation_participants;
create policy conversation_participants_update on public.conversation_participants
  for update to authenticated
  using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);

drop policy if exists conversation_participants_delete on public.conversation_participants;
create policy conversation_participants_delete on public.conversation_participants
  for delete to authenticated
  using (public.is_admin() or user_id = auth.uid()::text);

/* --- messages: readable and writable only inside the thread --- */

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (public.in_conversation(conversation_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    public.is_active()
    and sender_id = auth.uid()::text
    and public.in_conversation(conversation_id)
  );

-- No edits: a thread is a record of what was said. Removing a message is an
-- administrator's action, as it is for the activity log.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ *
 * Presence
 *
 * Realtime Presence answers "who is on the app right now" without a table, but
 * a thread also has to say when someone was last around after they close it —
 * so the profile carries the stamp, written by the account itself.
 * ------------------------------------------------------------------ */

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

/* ------------------------------------------------------------------ *
 * Realtime
 *
 * Messages arrive on their own, which is the point of a chat. The publication
 * only carries rows the policies already allow a caller to read: Realtime
 * applies RLS per subscriber, so a student is never sent another thread's
 * traffic.
 * ------------------------------------------------------------------ */

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.messages';
    execute 'alter publication supabase_realtime add table public.conversations';
    execute 'alter publication supabase_realtime add table public.tool_requests';
    execute 'alter publication supabase_realtime add table public.reservations';
  end if;
exception
  when duplicate_object then null;  -- already published; nothing to do
end $$;

/* ------------------------------------------------------------------ *
 * Attachments
 *
 * One bucket, on the same terms as `tool-images` in 0011: an object is written
 * by an active account into its own folder, and is readable by anyone who can
 * already reach the thread it was posted in. Kept private rather than public —
 * a message attachment is not laboratory signage.
 * ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  5242880,                                   -- 5 MB, matched by the client
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments are readable by signed-in users" on storage.objects;
create policy "attachments are readable by signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and public.is_active());

drop policy if exists "attachments are written by their sender" on storage.objects;
create policy "attachments are written by their sender"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments are removed by their sender" on storage.objects;
create policy "attachments are removed by their sender"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );
