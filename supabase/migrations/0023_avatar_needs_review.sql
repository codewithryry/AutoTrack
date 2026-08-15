/* ------------------------------------------------------------------ *
 * 0023 — a student's picture is reviewed like the rest of their profile
 *
 * `0022` added `avatar_url` as an ordinary column, which left a student able to
 * write it straight to their own row. The application now submits a picture the
 * same way it submits a name — parked in `pending_profile` until an
 * administrator approves it — and this is the database saying the same thing,
 * so the rule holds however the row is written.
 *
 * The guard is `0006`'s, with one column added to the list it already refuses
 * for a student. Nothing else about it changes: an administrator still writes
 * anything, an instructor's own flow is untouched, and `pending_profile` is
 * still the one place a submission may land.
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

  if not public.has_active_admin()
     and new.role = 'Admin'
     and new.status = 'Active'
     and new.id = old.id
     and (auth.uid() is null or new.id = auth.uid())
  then
    return new;
  end if;

  if new.role is distinct from old.role or new.status is distinct from old.status then
    raise exception 'Only an administrator may change a role or account status.'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'A profile id cannot be reassigned.' using errcode = '42501';
  end if;

  -- The reviewed set, now including the profile picture.
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
       or new.contact      is distinct from old.contact
       or new.avatar_url   is distinct from old.avatar_url)
  then
    raise exception
      'Profile changes need an administrator''s approval. Submit them for review instead.'
      using errcode = '42501';
  end if;

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
