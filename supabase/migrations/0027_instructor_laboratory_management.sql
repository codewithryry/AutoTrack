/* ------------------------------------------------------------------ *
 * 0027 — the instructor runs the laboratory
 *
 * An instructor already issued and received tools, worked the request queue and
 * managed servicing. This adds the rest of running a laboratory: the inventory
 * itself (adding and removing tools), the user directory, and reviewing a
 * student's profile changes. The reports are a read, so they need nothing here.
 *
 * One boundary is absolute, and it is the reason this migration is careful
 * rather than a one-line swap of `is_admin()` for `is_staff()`:
 *
 *     An instructor may never create, become, edit, suspend or delete an
 *     administrator.
 *
 * Without that, `USER_EDIT` would be a one-step route from instructor to
 * administrator and the distinction between the two roles would be decoration.
 * It is enforced twice below — in the policies, which decide which rows are
 * reachable, and in the guard trigger, which sees the old row and so is the
 * only place that can compare what a column was against what it is becoming.
 *
 * Unchanged and still administrator-only: settings, the data tools, and the
 * report exports. Unchanged for students: everything. Unchanged for public
 * sign-up: `Instructor` and `Student` only, never `Admin` — see the
 * self-registration branch of `profiles_insert`, which is copied here verbatim.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * profiles — the directory an instructor now keeps
 * ------------------------------------------------------------------ */

/**
 * Insert: an administrator may create anything. An instructor may create any
 * account that is not an administrator. A visitor may still only register
 * themselves, as `Instructor` or `Student`, at the status their role starts in.
 */
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_instructor() and public.is_active() and role <> 'Admin')
    or (
      id = auth.uid()
      and role in ('Instructor', 'Student')
      and ((role = 'Student' and status = 'Active')
        or (role = 'Instructor' and status = 'Pending'))
    )
  );

/**
 * Update: your own row, always. An administrator, any row. An instructor, any
 * row that is not an administrator's — and the `with check` half stops the
 * obvious move of editing a reachable row *into* an administrator.
 */
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    public.is_admin()
    or id = auth.uid()
    or (public.is_instructor() and public.is_active() and role <> 'Admin')
  )
  with check (
    public.is_admin()
    or id = auth.uid()
    or (public.is_instructor() and public.is_active() and role <> 'Admin')
  );

/** Delete: never your own account, and never an administrator's unless you are one. */
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    id <> auth.uid()
    and (
      public.is_admin()
      or (public.is_instructor() and public.is_active() and role <> 'Admin')
    )
  );

/* ------------------------------------------------------------------ *
 * The guard trigger
 *
 * Replaces the version in 0006, keeping every rule it had and adding the
 * instructor branch. `WITH CHECK` cannot see the previous row, so the
 * transitions — "was this an administrator?", "is this becoming one?" — can
 * only be judged here.
 * ------------------------------------------------------------------ */
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

  -- An id is never reassigned, by anyone but an administrator.
  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned.' using errcode = '42501';
  end if;

  /* --- the instructor, keeping the directory --------------------------- *
   * Everything an administrator does to a non-administrator account, except
   * anything that would reach an administrator: the row may not already be one
   * (the policy above agrees, but this is the half that cannot be bypassed by a
   * racing update), and it may not become one.
   * -------------------------------------------------------------------- */
  if public.is_instructor() and public.is_active() and new.id <> auth.uid() then
    if old.role = 'Admin' then
      raise exception 'Only an administrator may change an administrator account.'
        using errcode = '42501';
    end if;
    if new.role = 'Admin' then
      raise exception 'Only an administrator may grant the administrator role.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Unchanged from 0002/0006: for everybody else, role and status are never
  -- self-service. An instructor editing their *own* row lands here too, which
  -- is what stops them promoting themselves.
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

  -- A submission may only ever land in `Pending`. Approving and rejecting are
  -- reviewer actions, and a reviewer is now an administrator or an instructor —
  -- both of whom returned above before reaching this line.
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

/* ------------------------------------------------------------------ *
 * tools — the inventory is the laboratory's, not the system's
 *
 * `tools_update` already allowed staff (0002) and is left exactly as it is.
 * Only the two ends of a tool's life move.
 * ------------------------------------------------------------------ */

drop policy if exists tools_insert on public.tools;
create policy tools_insert on public.tools
  for insert to authenticated with check (public.is_staff() and public.is_active());

drop policy if exists tools_delete on public.tools;
create policy tools_delete on public.tools
  for delete to authenticated using (public.is_staff() and public.is_active());
