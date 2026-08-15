/* ------------------------------------------------------------------ *
 * 0021 — publish the rest of the operational tables to Realtime
 *
 * `0012` published the messaging tables and the request/reservation pair, so a
 * message or an approval raised by somebody else reaches an open screen on its
 * own. The tables the rest of the app is read from were left out, which is why
 * a borrow, a return, a tool status change or a new alert only appeared after a
 * manual refresh.
 *
 * Nothing about access changes: Realtime applies the same row-level policies
 * per subscriber, so a subscription can only ever deliver rows the subscriber
 * was already allowed to read — a student still sees their own transactions and
 * nobody else's.
 *
 * Guarded and idempotent: the publication may not exist on a self-hosted
 * database, and a table already published must not fail the migration.
 * ------------------------------------------------------------------ */

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array['tools', 'transactions', 'notifications', 'maintenance', 'profiles']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
