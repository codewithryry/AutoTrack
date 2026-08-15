-- `conversation_participants` needs the single `id` the data layer works in.
--
-- The table was written with a composite key, (conversation_id, user_id), which
-- is the right key for the data — but every read and write in `services/db.js`
-- addresses a row by one `id` column, so inserting a participant was refused by
-- PostgREST with "could not find the 'id' column ... in the schema cache", and
-- marking a thread read had nothing to match on.
--
-- The value is the one the application already computes: "<conversation>:<user>".
-- The composite primary key stays exactly as it was, so nothing about the
-- table's meaning changes — this only names what was already unique.

alter table public.conversation_participants
  add column if not exists id text;

update public.conversation_participants
   set id = conversation_id || ':' || user_id
 where id is null;

alter table public.conversation_participants
  alter column id set not null;

create unique index if not exists conversation_participants_id_key
  on public.conversation_participants (id);
