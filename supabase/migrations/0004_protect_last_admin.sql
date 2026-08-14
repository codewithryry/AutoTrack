-- The laboratory must always keep one active administrator.
--
-- `services/users.js` already refuses to delete, deactivate, suspend or demote
-- the last active administrator. That guard is the one people meet, and it
-- gives the better error message — but it runs in the browser, so a direct API
-- call with a valid administrator token would sail straight past it and lock
-- everyone out of user management permanently. There is no way back from that
-- state without the service-role key.
--
-- So the rule is restated here, where it cannot be skipped.
--
-- What this does NOT do
-- ---------------------
-- It does not cap the number of administrators: promoting a second, third or
-- tenth is unaffected, and demoting any of them is unaffected too — right up
-- until the last active one, which is the only case it refuses. Nothing about
-- the role model, the policies or self-registration changes.

create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  remaining integer;
begin
  -- Only rows that are *currently* an active administrator can trip this.
  if old.role <> 'Admin' or old.status <> 'Active' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- An update that leaves them an active administrator is not a removal.
  if tg_op = 'UPDATE' and new.role = 'Admin' and new.status = 'Active' then
    return new;
  end if;

  -- SECURITY DEFINER so the count sees every administrator, not just the rows
  -- the caller's policies expose. Counting under RLS could report zero for a
  -- caller who simply cannot see the others, and refuse a legitimate change.
  select count(*) into remaining
    from public.profiles
   where role = 'Admin' and status = 'Active' and id <> old.id;

  if remaining = 0 then
    -- No errcode: the default (P0001) passes the message through to the client
    -- untouched, so the person sees this sentence rather than a generic one.
    raise exception
      'The laboratory must keep at least one active administrator.';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_protect_last_admin on public.profiles;
create trigger profiles_protect_last_admin
  before update or delete on public.profiles
  for each row execute function public.protect_last_admin();
