/* ------------------------------------------------------------------ *
 * 0026 — push subscriptions, one row per device
 *
 * A Web Push subscription is the browser's own address for a device: an
 * endpoint URL and two keys. It is not a credential and it is not a profile
 * field, so it lives in its own table rather than on `profiles` — a person
 * installs the app on a phone and a laptop and gets a row for each.
 *
 * The endpoint is the primary key: re-subscribing on the same device returns
 * the same endpoint, so an upsert refreshes the keys instead of collecting
 * duplicates. Rows die with the account (`on delete cascade`), and
 * `api/push.js` deletes the ones the push service reports as gone.
 *
 * Nothing in the notification flow depends on this table: `notifications` is
 * still the record, and the in-app centre still reads it exactly as before.
 * This only says where a phone alert for that record should be delivered.
 * ------------------------------------------------------------------ */

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  p256dh     text        not null,
  auth       text        not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

/* A subscription belongs to the account that created it, and to nobody else.
   The sender never reads this table from the browser — `api/push.js` reads it
   with the service role, which bypasses these policies. */

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());
