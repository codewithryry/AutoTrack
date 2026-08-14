-- Student-submitted profile changes, reviewed by an administrator.
--
-- Why not `status`
-- ----------------
-- `status` gates sign-in: `is_active()` requires `Active`, and everything in the
-- application is gated on that. Parking a profile edit in `status = 'Pending'`
-- would lock the student out of the system for the sake of a phone-number
-- change. So review state lives in its own columns and touches nothing that
-- authorises anything.
--
-- How it works
-- ------------
-- The live columns are the *approved* profile — the only ones anything reads.
-- A student's edit is written to `pending_profile` (a jsonb patch) and never to
-- the live columns. An administrator approving it copies the patch across;
-- rejecting it discards the patch. Either way the live profile only ever
-- contains reviewed values.
--
-- The student keeps editing their own row — this is not a second table and not
-- a queue — so nothing about identity, RLS or the existing services changes
-- shape.

alter table public.profiles
  add column if not exists pending_profile        jsonb,
  add column if not exists profile_review_status  text not null default 'Approved'
    check (profile_review_status in ('Approved', 'Pending', 'Rejected')),
  add column if not exists profile_submitted_at   timestamptz,
  add column if not exists profile_reviewed_at    timestamptz,
  add column if not exists profile_reviewed_by    uuid references public.profiles(id) on delete set null,
  add column if not exists profile_review_note    text;

create index if not exists profiles_review_idx on public.profiles (profile_review_status)
  where profile_review_status = 'Pending';

/**
 * What a non-administrator may change on their own row.
 *
 * Everything else about their profile now goes through review, so the live
 * columns are off-limits to them entirely. `last_login_at` is exempt because
 * the sign-in path writes it on the user's own behalf — without that, signing
 * in would fail for every non-administrator.
 */
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

  -- Bootstrap (0005): while no active administrator exists, allow exactly the
  -- promotion that creates the first one.
  if not public.has_active_admin()
     and new.role = 'Admin'
     and new.status = 'Active'
     and new.id = old.id
     and (auth.uid() is null or new.id = auth.uid())
  then
    return new;
  end if;

  -- Unchanged from 0002: role, status and id are never self-service.
  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Only an administrator may change a role or account status.'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned.' using errcode = '42501';
  end if;

  -- Review applies to students only. An instructor's profile flow is
  -- deliberately left exactly as it was: they still edit their own details
  -- directly, and nothing about their account changes.
  if public.is_student()
     and (new.email        is distinct from old.email
       or new.first_name   is distinct from old.first_name
       or new.last_name    is distinct from old.last_name
       or new.full_name    is distinct from old.full_name
       or new.display_name is distinct from old.display_name
       or new.student_id   is distinct from old.student_id
       or new.employee_id  is distinct from old.employee_id
       or new.course       is distinct from old.course
       or new.year_level   is distinct from old.year_level
       or new.department   is distinct from old.department
       or new.contact      is distinct from old.contact)
  then
    raise exception
      'Profile changes need an administrator''s approval. Submit them for review instead.'
      using errcode = '42501';
  end if;

  -- A submission may only ever land in `Pending`; only a reviewer sets the
  -- other two, and only an administrator reaches the branch above.
  if new.profile_review_status is distinct from old.profile_review_status
     and new.profile_review_status <> 'Pending' then
    raise exception 'Only an administrator may approve or reject profile changes.'
      using errcode = '42501';
  end if;
  if new.profile_reviewed_by is distinct from old.profile_reviewed_by
     or new.profile_reviewed_at is distinct from old.profile_reviewed_at
     or new.profile_review_note is distinct from old.profile_review_note then
    raise exception 'Only an administrator may record a review.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();
