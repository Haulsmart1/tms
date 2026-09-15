-- prodfix_94: stamp job acceptance with the real caller.
-- Apply manually in the Supabase SQL editor. Safe to re-run.
--
-- FINDING (2026-09-15 follow-up to the production-readiness review). Accepting
-- a job is a browser write (app/jobs/page.tsx, app/planning/page.tsx) that
-- sends status 'planned' together with accepted_by = the signed-in user's id
-- and accepted_at = the browser's clock. Both values come from the client, so
-- any tenant member calling PostgREST directly could record a different user
-- as the person who accepted a job, or backdate the acceptance. The jobs table
-- is tenant-writable by design today (see the savePod finding), so the fix is
-- not to take the write away but to make the acceptance record trustworthy.
--
-- WHAT THIS DOES. A BEFORE INSERT OR UPDATE trigger on jobs. For a signed-in
-- caller (auth.uid() is not null):
--   * a write that sets accepted_by or accepted_at to a new non-null value, or
--   * an update that moves a job from 'pending_acceptance' to 'planned',
-- has accepted_by forced to auth.uid() and accepted_at forced to now().
-- Clearing both columns (sending a job back to pending acceptance) passes
-- unchanged. Unrelated updates pass unchanged.
--
-- NOT AFFECTED. The service role, postgres and the cron have no auth.uid(),
-- so server code (for example the Cambridge Audio RMA import, which creates
-- jobs in 'pending_acceptance') is untouched. The pages need no change: they
-- already send the caller's own id, which the trigger re-stamps identically.
--
-- WHY SECURITY INVOKER. The function only rewrites NEW; it needs no extra
-- rights, and invoker keeps auth.uid() reading the caller's own JWT.
--
-- Depends on live state not in the repo: jobs.accepted_by, jobs.accepted_at
-- and jobs.status. Checked below; the file raises and changes nothing if any
-- is missing.
--
-- ROLLBACK:
--   drop trigger if exists stamp_job_acceptance on public.jobs;
--   drop function if exists public.stamp_job_acceptance();

begin;

do $$
declare
  v_col text;
begin
  foreach v_col in array array['accepted_by', 'accepted_at', 'status'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'jobs' and column_name = v_col) then
      raise exception 'prodfix_94: public.jobs.% is missing. Nothing changed.', v_col;
    end if;
  end loop;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'prodfix_94: auth.uid() is missing. Nothing changed.';
  end if;
end $$;

create or replace function public.stamp_job_acceptance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.accepted_by is not null or new.accepted_at is not null then
      new.accepted_by := v_uid;
      new.accepted_at := now();
    end if;
    return new;
  end if;

  if (new.accepted_by is not null and new.accepted_by is distinct from old.accepted_by)
     or (new.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
     or (old.status = 'pending_acceptance' and new.status = 'planned') then
    new.accepted_by := v_uid;
    new.accepted_at := now();
  end if;

  return new;
end $$;

revoke all on function public.stamp_job_acceptance() from public, anon, authenticated;

drop trigger if exists stamp_job_acceptance on public.jobs;
create trigger stamp_job_acceptance
  before insert or update on public.jobs
  for each row execute function public.stamp_job_acceptance();

commit;

-- ===========================================================================
-- VERIFY. Rolled back; leaves nothing behind. Run the forged update as a
-- signed-in user (for example through the app's browser client), because the
-- SQL editor runs as postgres with no auth.uid() and is deliberately exempt.
-- ===========================================================================
--
-- 1. The trigger exists:
--      select tgname, tgenabled from pg_trigger
--      where tgrelid = 'public.jobs'::regclass and tgname = 'stamp_job_acceptance';
--
-- 2. From the browser console on a signed-in page, against a pending job in
--    your tenant, forge another user's id:
--      await supabase.from('jobs').update({ status: 'planned',
--        accepted_by: '00000000-0000-0000-0000-000000000000',
--        accepted_at: '2000-01-01T00:00:00Z' }).eq('id', '<job id>').select('accepted_by, accepted_at')
--    Expect accepted_by = your own user id and accepted_at = now.
select tgname as trigger_name, tgenabled as enabled
from pg_trigger
where tgrelid = 'public.jobs'::regclass and tgname = 'stamp_job_acceptance';
