-- Self-service account deletion — "Delete account" in the settings.
--
-- `services/auth.js → deleteAccount()` is the friendly path people meet: it
-- reads the directory for the loan and last-administrator checks and gives the
-- clear messages. This function is the boundary, the part that cannot be edited
-- away in the browser.
--
-- Why a function at all
-- ---------------------
-- The `profiles_delete` policy deliberately refuses a user deleting their own
-- row (`id <> auth.uid()`), and the sign-in credential lives in Supabase Auth,
-- which the anon key cannot touch. A SECURITY DEFINER function owned by the
-- migration role can do both in one step: deleting `auth.users` cascades to the
-- profile row (`profiles.id references auth.users on delete cascade`), so the
-- account is gone for good and the email can be registered again.
--
-- What is protected
-- -----------------
--   * A tool can never be stranded: an account with an open loan (Borrowed or
--     Overdue) is refused. `transactions.user_id` is deliberately text, so the
--     loan record survives the account — which means the tool would otherwise
--     stay marked out with nobody to claim it.
--   * The last active administrator cannot remove themselves. The
--     `profiles_protect_last_admin` trigger fires on the cascade delete too, so
--     this route cannot lock the laboratory out of user management.
--   * History survives: transactions, activity_logs and notifications are not
--     part of the profile row, so a deleted borrower's past loans stay in the
--     laboratory record exactly as the schema intends.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to delete your account.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.transactions t
     where t.user_id = auth.uid()::text
       and t.status in ('Borrowed', 'Overdue')
  ) then
    raise exception
      'Return your borrowed tools before deleting the account.'
      using errcode = '23514';
  end if;

  -- profiles_protect_last_admin refuses the cascade if this is the last one.
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;