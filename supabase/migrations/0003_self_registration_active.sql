-- Self-registration activates immediately.
--
-- Previously an instructor registered as `Pending` and waited for an
-- administrator to approve the account. That approval step is being removed:
-- both self-service roles now start `Active` and can use the application at
-- once.
--
-- What does NOT change
-- --------------------
-- `Admin` is still impossible to self-register. That is the privilege boundary
-- the policy exists to hold, and it is untouched below: the role must still be
-- one of `Instructor` or `Student`, and the row id must still equal the
-- caller's own `auth.uid()`.
--
-- `Pending` is still a valid status, and `is_active()` still gates everything on
-- `Active`. An administrator can still deactivate or suspend an account from the
-- Users page, and any account already sitting at `Pending` keeps working exactly
-- as before — this only changes what a *new* self-registration may ask for.

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      id = auth.uid()
      and role in ('Instructor', 'Student')
      and status = 'Active'
    )
  );
