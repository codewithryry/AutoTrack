/* ------------------------------------------------------------------ *
 * 0031 — an instructor waits; the approval record is the administrator's
 *
 * The gate itself is already in the database and is not re-stated here:
 *
 *   • `profiles_insert` (0028) lets a visitor create their own row as
 *     `Student`/`Active` or `Instructor`/`Pending`, and nothing else — so a
 *     self-registered instructor cannot start approved, whatever the browser
 *     sends.
 *   • `current_role_name()` (0002) only answers for an `Active` row, so
 *     `is_instructor()` and `is_staff()` are both false while the account is
 *     `Pending`. Every instructor-scoped policy in the schema is therefore
 *     already closed to a waiting account — there is no per-table rule to add.
 *   • `profiles_guard_privileged_columns()` (0028) refuses any self-service
 *     change to `role` or `status`, so a pending instructor cannot approve
 *     themselves by writing their own row.
 *
 * What was *not* covered is the approval record. `approved_at` and
 * `approved_by` are the evidence that an administrator made the decision, and
 * until now nothing stopped anyone else from writing them: a self-insert could
 * arrive with both already filled in, and an instructor editing a student's row
 * (or anybody editing their own) could stamp them afterwards. The columns would
 * then say a decision was taken that never was. This migration makes them what
 * the review columns in 0006 already are — administrator-only.
 *
 * Two changes, both narrow:
 *
 *   1. `profiles_insert` gains `approved_at is null and approved_by is null`
 *      for every non-administrator insert. An administrator creating an account
 *      outright is unaffected; the app's own sign-up path never sends either
 *      column, so nothing legitimate changes.
 *   2. The guard trigger refuses a non-administrator update that alters either
 *      column, worded like the `profile_reviewed_by` rule beside it. The check
 *      sits *above* the instructor branch, so it holds for an instructor
 *      managing students as much as for a user editing their own row.
 *
 * Everything else in 0028 — the select/update/delete policies, the bootstrap
 * branch, the instructor-manages-students rule, the student review flow — is
 * reproduced verbatim, because the function has to be re-created whole.
 *
 * Existing rows are not touched: no data is rewritten, and an account that is
 * already `Active` stays exactly as it is.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Inserting
 * ------------------------------------------------------------------ */

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      -- Nobody but an administrator creates a row that already claims to have
      -- been approved.
      approved_at is null
      and approved_by is null
      and (
        (public.is_instructor() and public.is_active() and role = 'Student')
        or (
          id = auth.uid()
          and role in ('Instructor', 'Student')
          -- The gate, unchanged from 0028: a student is usable at once, an
          -- instructor waits for an administrator.
          and ((role = 'Student' and status = 'Active')
            or (role = 'Instructor' and status = 'Pending'))
        )
      )
    )
  );

/* ------------------------------------------------------------------ *
 * The guard trigger
 *
 * 0028's function with one block added — see the header.
 * ------------------------------------------------------------------ */

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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

  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned.' using errcode = '42501';
  end if;

  -- New in 0031. Above the instructor branch on purpose: approving an account
  -- is an administrator's decision, and so is the record of it.
  if new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'Only an administrator may approve an account.'
      using errcode = '42501';
  end if;

  -- The instructor, keeping the students. A student's row, staying a student's
  -- row: anything else is an administrator's to change.
  if public.is_instructor() and public.is_active() and new.id <> auth.uid() then
    if old.role <> 'Student' then
      raise exception 'An instructor may only manage student accounts.'
        using errcode = '42501';
    end if;
    if new.role <> 'Student' then
      raise exception 'An instructor may only assign the student role.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Everybody else, including an instructor editing their own row: role and
  -- status are never self-service. This is what stops a pending instructor
  -- writing themselves Active.
  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Only an administrator may change a role or account status.'
      using errcode = '42501';
  end if;

  -- Review applies to students only, exactly as in 0006.
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
      'Profile changes need approval. Submit them for review instead.'
      using errcode = '42501';
  end if;

  if new.profile_review_status is distinct from old.profile_review_status
     and new.profile_review_status <> 'Pending' then
    raise exception 'Only laboratory staff may approve or reject profile changes.'
      using errcode = '42501';
  end if;
  if new.profile_reviewed_by is distinct from old.profile_reviewed_by
     or new.profile_reviewed_at is distinct from old.profile_reviewed_at
     or new.profile_review_note is distinct from old.profile_review_note then
    raise exception 'Only laboratory staff may record a review.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();
