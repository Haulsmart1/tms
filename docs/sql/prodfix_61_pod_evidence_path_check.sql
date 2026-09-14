-- prodfix_61_pod_evidence_path_check.sql
--
-- Why: review finding POD-10. The service role signs and downloads
-- pod_evidence.storage_path for the public share page and PDF, and the service
-- role bypasses the pod-files bucket's per-tenant path policy. The console used
-- to insert pod_evidence rows from the browser with a client-chosen path, so a
-- tenant could store ANOTHER tenant's object path in its own evidence row and
-- have the platform serve that file.
--
-- The app now (a) records evidence only through server routes that build the
-- path themselves and (b) skips any evidence whose path is outside
-- <tenant_id>/<job_id>/<stop_id>/ before signing. This constraint makes the
-- database refuse such a row as well, whoever writes it.
--
-- NOT VALID: the constraint applies to every new or updated row but does not
-- scan existing rows, so this cannot fail on legacy data. The verify query
-- lists existing rows that would violate it; if it returns zero rows, run
--   alter table public.pod_evidence validate constraint pod_evidence_path_owned;
--
-- A NULL stop_id or job_id fails the check on purpose (coalesce to a value no
-- path can start with): every evidence path the app writes includes both.
--
-- Can only narrow what is accepted; it grants nothing. Idempotent.
-- Live-state assumption: pod_evidence has tenant_id, job_id, stop_id and
-- storage_path columns (all used by the app today). The DDL for pod_evidence
-- is not in the repo; docs/sql/diag_2026_09_14_live_state.sql shows its shape.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pod_evidence_path_owned'
      and conrelid = 'public.pod_evidence'::regclass
  ) then
    alter table public.pod_evidence
      add constraint pod_evidence_path_owned
      check (
        storage_path like (
          tenant_id::text || '/' ||
          coalesce(job_id::text, '<no-job>') || '/' ||
          coalesce(stop_id::text, '<no-stop>') || '/%'
        )
        and storage_path !~ '(^|/)\.\.?(/|$)'
        and storage_path !~ '\\'
        and storage_path !~ '//'
      )
      not valid;
  end if;
end $$;

commit;

-- VERIFY 1 (expect one row, convalidated = false until you validate it):
-- select conname, convalidated from pg_constraint
-- where conname = 'pod_evidence_path_owned' and conrelid = 'public.pod_evidence'::regclass;
--
-- VERIFY 2 (existing rows that break the rule; expect zero before validating):
-- select id, tenant_id, job_id, stop_id, storage_path
-- from public.pod_evidence
-- where not (
--   storage_path like (tenant_id::text || '/' || coalesce(job_id::text, '<no-job>') || '/' || coalesce(stop_id::text, '<no-stop>') || '/%')
--   and storage_path !~ '(^|/)\.\.?(/|$)'
--   and storage_path !~ '\\'
--   and storage_path !~ '//'
-- );
