-- Break the first-administrator deadlock.
--
-- The problem
-- -----------
-- `profiles_guard_privileged_columns()` (0002) refuses any change to `role` or
-- `status` unless `is_admin()` is true. On a fresh database nobody is an
-- administrator, so nobody can be made one — and the escape hatch does not work
-- either: in the SQL editor `auth.uid()` is NULL, so `current_role_name()`
-- returns NULL, `is_admin()` is not true, and the trigger refuses the promotion
-- exactly as it would for a student. The database is closed to itself.
--
-- The fix
-- -------
-- One narrow exception, evaluated in the database: while there are **zero
-- active administrators**, a profile may be promoted to `Admin` + `Active`.
--
-- Why this is not a back door:
--
--  * **It closes itself.** The moment the first administrator exists,
--    `has_active_admin()` is true and the exception stops applying — for
--    everyone, permanently, with no flag to remember to turn off. The only way
--    to reopen it is to remove every active administrator, which
--    `0004_protect_last_admin.sql` already refuses.
--
--  * **It only ever grants the bootstrap transition.** The row must come out as
--    `Admin` + `Active`. It cannot be used to hand out any other role or status,
--    and it cannot touch any other column.
--
--  * **It cannot be aimed at someone else.** A caller with a session may only
--    promote their own row (`new.id = auth.uid()`). A session-less caller — the
--    SQL editor, i.e. someone already holding database credentials — may promote
--    any row, which is the operator path this exists to serve.
--
-- What it inherits, honestly: on a brand-new database with no administrator,
-- whichever authenticated account acts first can become the first
-- administrator. That is what "the first user is the administrator" means, and
-- it is the same exposure as any other first-run bootstrap. It lasts only until
-- the first promotion. Promote the intended account before handing the sign-up
-- URL to anyone else.
--
-- Nothing else changes: `profiles_guard_privileged_columns()` is replaced in
-- place (not removed), RLS stays on, every policy from 0002–0004 is untouched,
-- and no elevated key is involved anywhere.

/**
 * Is there an active administrator at all?
 *
 * SECURITY DEFINER so the answer is the truth about the table rather than the
 * truth about what the caller may see: under RLS a student sees only their own
 * row, so an RLS-bound count would read zero and hold the bootstrap window open
 * forever.
 */
create or replace function public.has_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles where role = 'Admin' and status = 'Active'
  )
$$;

revoke all on function public.has_active_admin() from public, anon;
grant execute on function public.has_active_admin() to authenticated;

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- An administrator may change anything, as before.
  if public.is_admin() then
    return new;
  end if;

  -- Bootstrap: while no active administrator exists, allow exactly the
  -- promotion that creates the first one.
  if not public.has_active_admin()
     and new.role = 'Admin'
     and new.status = 'Active'
     and new.id = old.id
     -- With a session: your own row only. Without one (the SQL editor), the
     -- caller already holds database credentials.
     and (auth.uid() is null or new.id = auth.uid())
  then
    return new;
  end if;

  -- Everything below is unchanged from 0002.
  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Only an administrator may change a role or account status.'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The trigger itself is unchanged and still attached; replacing the function
-- above is enough. Re-created defensively in case an earlier run dropped it.
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();
