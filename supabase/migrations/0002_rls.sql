-- Row Level Security.
--
-- The same role model the application already enforces in
-- `src/utils/permissions.js` and in the read scoping of `src/services/db.js`,
-- restated where it cannot be edited away:
--
--   Admin       full access to every table.
--   Instructor  runs the tool crib — issues and receives tools for anyone,
--               corrects transactions, manages maintenance, reads the directory.
--               No user management, no settings.
--   Student     reads the inventory; reads and creates only their own loans;
--               reads their own notifications plus laboratory-wide ones.
--
-- A user's role is read from their own `profiles` row on every request. Nothing
-- the client sends is trusted for authorisation, so editing the bundle changes
-- nothing.
--
-- Only `Active` authorises anything. A `Pending` instructor can read their own
-- profile — which is how the login screen can explain the wait — and no more.
--
-- Recursion, and why the helpers are SECURITY DEFINER
-- --------------------------------------------------
-- A policy on `profiles` that reads `profiles` to find the caller's role would
-- re-enter that same policy forever. The helpers below are therefore SECURITY
-- DEFINER and run outside RLS. They are the only thing that does; each takes no
-- argument a caller can influence and answers a single question about
-- `auth.uid()`, so none can be turned into a way to read another user's row.
-- `search_path` is pinned on each: a SECURITY DEFINER function that resolves
-- unqualified names through a caller-controlled search_path is an escalation
-- hole.
--
-- The first administrator
-- ----------------------
-- Self-registration deliberately cannot create an `Admin` — that is the whole
-- point of the role check below. With an empty database there is no
-- administrator to promote anyone, so the first one is made once, by hand, in
-- the SQL editor after they have signed up:
--
--   update public.profiles set role = 'Admin', status = 'Active'
--    where lower(email) = lower('you@example.edu');
--
-- That is an operator action against an existing account, not seeded data.

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  -- Only while the account is Active; anything else authorises nothing.
  select p.role from public.profiles p
   where p.id = auth.uid() and p.status = 'Active'
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.status = 'Active'
  )
$$;

create or replace function public.is_admin() returns boolean language sql stable as $$
  select public.current_role_name() = 'Admin' $$;

create or replace function public.is_instructor() returns boolean language sql stable as $$
  select public.current_role_name() = 'Instructor' $$;

create or replace function public.is_student() returns boolean language sql stable as $$
  select public.current_role_name() = 'Student' $$;

/** Admin + instructor: the laboratory-wide view. */
create or replace function public.is_staff() returns boolean language sql stable as $$
  select public.current_role_name() in ('Admin', 'Instructor') $$;

revoke all on function public.current_role_name() from public, anon;
revoke all on function public.is_active() from public, anon;
grant execute on function
  public.current_role_name(), public.is_active(), public.is_admin(),
  public.is_instructor(), public.is_student(), public.is_staff()
  to authenticated;

/* ------------------------------------------------------------------ *
 * Enable RLS everywhere.
 *
 * With RLS on and no matching policy, a request is refused — the same
 * deny-by-default direction the application's own scoping fails in.
 * ------------------------------------------------------------------ */
alter table public.profiles      enable row level security;
alter table public.tools         enable row level security;
alter table public.transactions  enable row level security;
alter table public.maintenance   enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.settings      enable row level security;

-- Nothing is readable without a session.
revoke all on all tables in schema public from anon;

/* ------------------------------------------------------------------ *
 * profiles
 * ------------------------------------------------------------------ */

-- Your own profile, always (that is how the app resolves your role at sign-in,
-- and how a pending account is told it is pending). Anyone else's: staff only.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- Self-registration: the one insert an account may make before it has a
-- profile. The row must be its own, the role may never be Admin, and the
-- starting status is fixed per role so an instructor cannot register as
-- already-approved. An administrator may create anything.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
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
  using (public.is_admin() or id = auth.uid())
  with check (public.is_admin() or id = auth.uid());

-- `WITH CHECK` cannot see the previous row, so "only an administrator may
-- change a role or a status" is enforced here.
create or replace function public.profiles_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_admin() then return new; end if;
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

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

/* ------------------------------------------------------------------ *
 * tools
 * ------------------------------------------------------------------ */

drop policy if exists tools_select on public.tools;
create policy tools_select on public.tools
  for select to authenticated using (public.is_active());

drop policy if exists tools_insert on public.tools;
create policy tools_insert on public.tools
  for insert to authenticated with check (public.is_admin());

-- Staff maintain the inventory. A student may only move a tool between
-- available and borrowed/damaged, and only while it is booked out to them;
-- the column-level half is enforced by the trigger below.
drop policy if exists tools_update on public.tools;
create policy tools_update on public.tools
  for update to authenticated
  using (
    public.is_staff()
    or (public.is_student()
        and (status = 'Available' or current_borrower_id = auth.uid()::text))
  )
  with check (
    public.is_staff()
    or (public.is_student() and status in ('Available', 'Borrowed', 'Damaged'))
  );

create or replace function public.tools_guard_student_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;

  -- Checkout: Available -> Borrowed, claimed by the caller.
  if old.status = 'Available' and new.status = 'Borrowed'
     and new.current_borrower_id = auth.uid()::text
     and new.name = old.name and new.category = old.category
     and new.condition = old.condition and new.location = old.location then
    return new;
  end if;

  -- Return: only the borrower, releasing the tool.
  if old.current_borrower_id = auth.uid()::text
     and new.status in ('Available', 'Damaged')
     and new.current_borrower_id is null
     and new.name = old.name and new.category = old.category
     and new.location = old.location then
    return new;
  end if;

  raise exception 'A student may only borrow or return a tool.' using errcode = '42501';
end;
$$;

drop trigger if exists tools_student_guard on public.tools;
create trigger tools_student_guard before update on public.tools
  for each row execute function public.tools_guard_student_update();

drop policy if exists tools_delete on public.tools;
create policy tools_delete on public.tools
  for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ *
 * transactions
 * ------------------------------------------------------------------ */

-- A student reads only their own loans. This is also what makes an unfiltered
-- "select all transactions" safe: the other rows simply are not visible.
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text));

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    public.is_staff()
    or (public.is_active() and public.is_student()
        and user_id = auth.uid()::text
        and status = 'Borrowed'
        and return_date is null)
  );

-- Closing a loan is allowed for its borrower and for staff; a student cannot
-- extend their own due date or reassign a loan.
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text))
  with check (
    public.is_staff()
    or (public.is_active() and user_id = auth.uid()::text
        and status in ('Returned', 'Damaged'))
  );

create or replace function public.transactions_guard_borrower_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;
  if new.user_id is distinct from old.user_id
     or new.tool_id is distinct from old.tool_id
     or new.due_date is distinct from old.due_date
     or new.borrow_date is distinct from old.borrow_date then
    raise exception 'A borrower may only close their own loan.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_borrower_guard on public.transactions;
create trigger transactions_borrower_guard before update on public.transactions
  for each row execute function public.transactions_guard_borrower_update();

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ *
 * maintenance — internal laboratory records, reads included
 * ------------------------------------------------------------------ */

drop policy if exists maintenance_select on public.maintenance;
create policy maintenance_select on public.maintenance
  for select to authenticated using (public.is_staff());

drop policy if exists maintenance_insert on public.maintenance;
create policy maintenance_insert on public.maintenance
  for insert to authenticated with check (public.is_staff());

drop policy if exists maintenance_update on public.maintenance;
create policy maintenance_update on public.maintenance
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists maintenance_delete on public.maintenance;
create policy maintenance_delete on public.maintenance
  for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ *
 * notifications
 * ------------------------------------------------------------------ */

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    public.is_staff()
    or (public.is_active() and (user_id = auth.uid()::text or user_id is null))
  );

-- A student may only raise a notification for themselves. A laboratory-wide
-- alert is read by everybody and deletable only by staff, so creating one stays
-- staff-only — otherwise one account could fill every notification centre with
-- text nobody else can remove.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (
    public.is_staff()
    or (public.is_active() and user_id = auth.uid()::text and read = false)
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (
    public.is_staff()
    or (public.is_active() and (user_id = auth.uid()::text or user_id is null))
  )
  with check (
    public.is_staff()
    or (public.is_active() and (user_id = auth.uid()::text or user_id is null))
  );

-- Marking as read is the only update a non-staff user may make.
create or replace function public.notifications_guard_read_only()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_staff() then return new; end if;
  if new.type is distinct from old.type or new.title is distinct from old.title
     or new.message is distinct from old.message or new.user_id is distinct from old.user_id
     or new.tool_id is distinct from old.tool_id or new.link is distinct from old.link then
    raise exception 'Only the read flag may be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_read_guard on public.notifications;
create trigger notifications_read_guard before update on public.notifications
  for each row execute function public.notifications_guard_read_only();

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (public.is_staff() or (public.is_active() and user_id = auth.uid()::text));

/* ------------------------------------------------------------------ *
 * activity_logs — append-only
 *
 * Any active user's actions write to it (a student borrowing a tool records an
 * entry), only staff may read it, and nobody may rewrite history: there is no
 * UPDATE policy at all, so every update is refused.
 * ------------------------------------------------------------------ */

drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated using (public.is_staff());

drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert on public.activity_logs
  for insert to authenticated
  with check (
    public.is_active()
    and (public.is_staff() or user_id = auth.uid()::text)
  );

drop policy if exists activity_logs_delete on public.activity_logs;
create policy activity_logs_delete on public.activity_logs
  for delete to authenticated using (public.is_admin());

/* ------------------------------------------------------------------ *
 * settings — readable by everyone signed in, writable only by an administrator
 * ------------------------------------------------------------------ */

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (public.is_active());

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated with check (public.is_admin());

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete to authenticated using (public.is_admin());
