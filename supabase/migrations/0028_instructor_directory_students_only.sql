/* ------------------------------------------------------------------ *
 * 0028 — an instructor's directory is the students in it
 *
 * 0027 gave the instructor the user directory, bounded only by "not an
 * administrator". This narrows it to what it should have been: an instructor
 * sees and manages **students**, plus their own account. Not administrators,
 * and not other instructors — neither to read, nor to edit, nor to delete.
 *
 * Read this next to 0013. That migration opened `profiles_select` to every
 * signed-in account so that anybody could be *named* when starting a
 * conversation, which in practice made the whole directory readable by
 * everyone. That is the line this migration takes back for instructors: the
 * `role in (...)` catch-all is replaced by a per-role rule.
 *
 *   Administrator  every profile, as before.
 *   Instructor     their own, plus every `Student`.
 *   Student        unchanged from 0013 — any profile, so the "new
 *                  conversation" picker still works for them.
 *
 * Consequence, stated plainly rather than discovered later: an instructor can
 * no longer *start* a conversation with an administrator or another instructor,
 * because the compose picker cannot name somebody it may not read. Threads that
 * already exist are unaffected — messages are scoped by membership, not by the
 * profile table. If that matters, the fix is a narrow directory view
 * (id, name, role only), not widening this policy.
 *
 * Unchanged: sign-up (`Instructor` and `Student`, never `Admin`), the
 * last-administrator protection in 0004, the student review flow in 0006, and
 * every administrator behaviour.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    -- Always your own row. This is how the app resolves a role at sign-in, so
    -- without it nobody could sign in at all.
    id = auth.uid()
    or public.is_admin()
    -- 0013, kept exactly as it was for students.
    or public.is_student()
    -- The change: an instructor reads students, and nobody else.
    or (public.is_instructor() and role = 'Student')
  );

/* ------------------------------------------------------------------ *
 * Writing
 *
 * The same rule, three more times. `role = 'Student'` replaces 0027's
 * `role <> 'Admin'` everywhere an instructor is named.
 * ------------------------------------------------------------------ */

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_instructor() and public.is_active() and role = 'Student')
    or (
      id = auth.uid()
      and role in ('Instructor', 'Student')
      and ((role = 'Student' and status = 'Active')
        or (role = 'Instructor' and status = 'Pending'))
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or id = auth.uid()
    or (public.is_instructor() and public.is_active() and role = 'Student')
  )
  with check (
    public.is_admin()
    or id = auth.uid()
    or (public.is_instructor() and public.is_active() and role = 'Student')
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    id <> auth.uid()
    and (
      public.is_admin()
      or (public.is_instructor() and public.is_active() and role = 'Student')
    )
  );

/* ------------------------------------------------------------------ *
 * The guard trigger
 *
 * Replaces 0027's version. Only the instructor branch changes: the row must be
 * a student's before the update and still be a student's after it. `WITH CHECK`
 * cannot see the old row, so this is the only place the "was it a student?"
 * half can be asked — which is what stops an instructor promoting a student to
 * instructor and then working on the account freely.
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
  -- status are never self-service.
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
