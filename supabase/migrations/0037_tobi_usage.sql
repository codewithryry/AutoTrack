/* ------------------------------------------------------------------ *
 * 0037 — TOBI usage limits
 *
 * One row per request TOBI accepted, so the server can refuse an account's
 * next request once it has used its daily quota or is sending too quickly —
 * before anything is sent to the AI provider. No conversation content is
 * stored: who, when, which role, the outcome, and token counts only.
 *
 * The account can read its own rows (for "7 / 20 today") and can write none.
 * Every write goes through the two functions below, which run as the owner:
 *
 *   tobi_usage_begin   under a per-account lock, counts today's requests and
 *                      the last minute's, and only if both are under the
 *                      limits the server passes, records a `pending` row.
 *                      The daily count includes pending and succeeded rows.
 *   tobi_usage_finish  marks that row `ok` (with token counts) or `failed` —
 *                      a failed request gives its unit back.
 *
 * Why a failure cannot be faked to refund quota: `begin` stores only the hash
 * of a one-time secret the TOBI server generates per request and never sends
 * to the browser, and `finish` requires that secret. A user calling the
 * functions directly can only ever add rows against themselves.
 *
 * The limits themselves live in the server's configuration
 * (`api/_lib/tobi/config.js`), not here, so they change without a migration.
 * The account is always `auth.uid()` — never a value from the caller.
 * ------------------------------------------------------------------ */

create table if not exists public.tobi_usage (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  role           text not null default '',
  usage_date     date not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'ok', 'failed')),
  input_tokens   integer not null default 0 check (input_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  nonce_hash     text not null,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists tobi_usage_user_day_idx  on public.tobi_usage (user_id, usage_date);
create index if not exists tobi_usage_user_time_idx on public.tobi_usage (user_id, created_at desc);

alter table public.tobi_usage enable row level security;

drop policy if exists tobi_usage_select on public.tobi_usage;
create policy tobi_usage_select on public.tobi_usage
  for select to authenticated
  using (user_id = auth.uid());

-- No insert, update or delete policy: the functions below are the only writers.
revoke all on public.tobi_usage from anon;
revoke insert, update, delete on public.tobi_usage from authenticated;
grant select on public.tobi_usage to authenticated;

/* ------------------------------- begin ------------------------------- */

create or replace function public.tobi_usage_begin(
  p_nonce         text,
  p_daily_limit   integer,
  p_minute_limit  integer,
  p_timezone      text default 'Asia/Manila'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_day     date;
  v_used    integer;
  v_recent  integer;
  v_oldest  timestamptz;
  v_id      uuid;
begin
  if v_uid is null or not public.is_active() then
    raise exception 'Sign in with an active account to use TOBI.' using errcode = '42501';
  end if;
  if p_nonce is null or char_length(p_nonce) < 32 then
    raise exception 'A request secret is required.' using errcode = '22023';
  end if;
  if p_daily_limit is null or p_daily_limit < 1 or p_minute_limit is null or p_minute_limit < 1 then
    raise exception 'Limits must be positive.' using errcode = '22023';
  end if;

  -- One request at a time per account, so two sent together cannot both slip
  -- under the last unit of quota.
  perform pg_advisory_xact_lock(hashtextextended('tobi_usage:' || v_uid::text, 0));

  -- "Today" is the laboratory's day: it resets at midnight in its time zone.
  v_day := (now() at time zone p_timezone)::date;
  select role into v_role from public.profiles where id = v_uid;

  select count(*) into v_used
    from public.tobi_usage
   where user_id = v_uid and usage_date = v_day and status in ('pending', 'ok');

  if v_used >= p_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'daily', 'used', v_used, 'limit', p_daily_limit);
  end if;

  select count(*), min(created_at) into v_recent, v_oldest
    from public.tobi_usage
   where user_id = v_uid and created_at > now() - interval '60 seconds';

  if v_recent >= p_minute_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate',
      'used', v_used,
      'limit', p_daily_limit,
      'retryAfter', greatest(1, ceil(extract(epoch from (v_oldest + interval '60 seconds' - now())))::integer)
    );
  end if;

  insert into public.tobi_usage (user_id, role, usage_date, nonce_hash)
  values (v_uid, coalesce(v_role, ''), v_day, encode(sha256(convert_to(p_nonce, 'UTF8')), 'hex'))
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'id', v_id, 'used', v_used + 1, 'limit', p_daily_limit);
end;
$$;

/* ------------------------------- finish ------------------------------ */

create or replace function public.tobi_usage_finish(
  p_id             uuid,
  p_nonce          text,
  p_status         text,
  p_input_tokens   integer default 0,
  p_output_tokens  integer default 0
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_status not in ('ok', 'failed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;

  update public.tobi_usage
     set status        = p_status,
         input_tokens  = greatest(0, coalesce(p_input_tokens, 0)),
         output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
         finished_at   = now()
   where id = p_id
     and user_id = auth.uid()
     and status = 'pending'
     and nonce_hash = encode(sha256(convert_to(coalesce(p_nonce, ''), 'UTF8')), 'hex');

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.tobi_usage_begin(text, integer, integer, text) from public;
revoke all on function public.tobi_usage_begin(text, integer, integer, text) from anon;
grant execute on function public.tobi_usage_begin(text, integer, integer, text) to authenticated;

revoke all on function public.tobi_usage_finish(uuid, text, text, integer, integer) from public;
revoke all on function public.tobi_usage_finish(uuid, text, text, integer, integer) from anon;
grant execute on function public.tobi_usage_finish(uuid, text, text, integer, integer) to authenticated;

comment on table public.tobi_usage is
  'One row per TOBI request: who, when, outcome and token counts. No conversation content.';
