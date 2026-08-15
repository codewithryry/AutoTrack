/* ------------------------------------------------------------------ *
 * 0024 — a submitted profile change tells the administrators
 *
 * A student or an instructor cannot write a notification addressed to somebody
 * else — `0002` only lets them write their own — so the alert is raised by the
 * database, on the row that changed, rather than by the client that changed it.
 *
 * One notification per active administrator, addressed to them, the moment a
 * profile goes into review. Nothing else about the review flow moves: the
 * submission is still the same `pending_profile` patch, still approved and
 * rejected from the same page, and an administrator's own edits still bypass
 * review entirely (they never set `Pending`, so this never fires for them).
 *
 * `dedupe_key` carries the submission's own timestamp, so re-submitting raises
 * a fresh alert while the same submission cannot be announced twice.
 * ------------------------------------------------------------------ */

create or replace function public.notify_admins_of_profile_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_row record;
  submitted timestamptz := coalesce(new.profile_submitted_at, now());
  who       text        := coalesce(new.full_name, new.email, 'An account');
begin
  -- Only the transition into review, and only for somebody else's account:
  -- an administrator editing their own profile does not go through this at all.
  if new.profile_review_status <> 'Pending'
     or old.profile_review_status is not distinct from new.profile_review_status then
    return new;
  end if;

  for admin_row in
    select id from public.profiles where role = 'Admin' and status = 'Active'
  loop
    insert into public.notifications
      (id, type, title, message, user_id, user_name, link, dedupe_key, read, created_at)
    values (
      'NOTIF-' || replace(gen_random_uuid()::text, '-', ''),
      'system',
      'Profile change needs approval',
      who || ' submitted profile changes for approval.',
      admin_row.id,
      who,
      '/users',
      'profile-review:' || new.id || ':' || extract(epoch from submitted)::bigint
        || ':' || admin_row.id,
      false,
      now()
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists profiles_notify_admins_of_review on public.profiles;
create trigger profiles_notify_admins_of_review
  after update of profile_review_status on public.profiles
  for each row execute function public.notify_admins_of_profile_review();

-- No unique index on `dedupe_key`: a database that already carries a repeated
-- key would refuse to build one, and the trigger above fires only on the
-- transition into review, which is what actually keeps this to one alert.
