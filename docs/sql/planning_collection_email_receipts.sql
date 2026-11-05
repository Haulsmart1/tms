-- Extend the existing private notification ledger; no browser grants or
-- policies change. Microsoft 365 accepted means accepted, not delivered.
begin;
alter table public.job_notification_log drop constraint job_notification_log_type_valid;
alter table public.job_notification_log add constraint job_notification_log_type_valid
  check (notification_type in ('planned_window','driver_on_way','eta_update','change_request_update','collection_receipt'));
commit;
