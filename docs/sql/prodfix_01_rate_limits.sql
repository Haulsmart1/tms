-- prodfix_01_rate_limits.sql
--
-- Durable, cross-instance rate limiting for public and abuse-prone routes
-- (request-access, login, quote intake, quote accept, POD/invoice/quote email,
-- invites, POD share PDF, TomTom proxy). Review findings AUTH-7, AUTH-8,
-- ACC-18, INV-7, POD-3, POD-9, PLAN-25.
--
-- Why a table: every in-memory limiter in the app is per serverless instance
-- and resets on deploy, so it is a speed bump, not a limit.
--
-- Safe to re-run. Apply in the Supabase SQL editor. Only the service role can
-- call the function; no client role can read or write the table.

begin;

create table if not exists public.rate_limit_hits (
  bucket       text        not null,
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, key, window_start)
);

alter table public.rate_limit_hits enable row level security;
alter table public.rate_limit_hits force row level security;
revoke all on table public.rate_limit_hits from public, anon, authenticated;

create index if not exists rate_limit_hits_window_idx on public.rate_limit_hits (window_start);

-- Returns true when this hit is within the limit, false when it is over.
-- Fixed window: windows are aligned to multiples of p_window_seconds since epoch.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_key text,
  p_window_seconds integer,
  p_max integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_bucket is null or p_key is null or p_window_seconds is null or p_window_seconds < 1
     or p_max is null or p_max < 1 then
    raise exception 'rate_limit_hit: invalid arguments';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits as r (bucket, key, window_start, hits)
  values (left(p_bucket, 64), left(p_key, 256), v_window, 1)
  on conflict (bucket, key, window_start)
  do update set hits = r.hits + 1
  returning hits into v_hits;

  -- Opportunistic cleanup, about 1 call in 200, of windows older than a day.
  if random() < 0.005 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end $$;

revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

commit;

-- Verify (expect: rls=true, anon/authenticated have no privileges, only service_role executes):
-- select relrowsecurity from pg_class where relname = 'rate_limit_hits';
-- select has_function_privilege('anon', 'public.rate_limit_hit(text,text,integer,integer)', 'execute'),
--        has_function_privilege('authenticated', 'public.rate_limit_hit(text,text,integer,integer)', 'execute');
