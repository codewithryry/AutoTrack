import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

/**
 * Runs the real migrations against an in-process Postgres, with the small
 * Supabase-provided pieces stubbed: an `auth` schema, `auth.users`, and an
 * `auth.uid()` that reads a session variable so a test can "become" a user.
 */
export async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text);
    -- auth.uid() reads a GUC so tests can switch identity; empty = no session.
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='authenticated')
        then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname='anon')
        then create role anon; end if;
    end $$;
  `)
  for (const f of ['0001_schema.sql','0002_rls.sql','0003_self_registration_active.sql',
                   '0004_protect_last_admin.sql','0005_bootstrap_first_admin.sql',
                   '0006_profile_change_review.sql','0007_self_delete_account.sql',
                   '0008_location_checkpoints.sql','0009_tool_delete_preserve_history.sql',
                   '0010_settings_department_page.sql']) {
    try { await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8')) }
    catch (e) { throw new Error(`${f} failed: ${e.message}`) }
  }
  return db
}

/** Become a user (or nobody, for the SQL-editor case). */
export const become = (db, uid) =>
  db.exec(`select set_config('test.uid', ${uid ? `'${uid}'` : `''`}, false)`)

/** Insert an auth user + profile directly (setup, bypassing app paths). */
export async function seedUser(db, { id, email, role, status }) {
  await db.query('insert into auth.users (id,email) values ($1,$2)', [id, email])
  await db.query(
    `insert into public.profiles (id,email,full_name,role,status) values ($1,$2,$3,$4,$5)`,
    [id, email, email.split('@')[0], role, status],
  )
}
