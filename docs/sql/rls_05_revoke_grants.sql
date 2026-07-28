-- RLS Tenancy Hardening (Phase 1) -- 05: revoke stray grants (second layer). Safe to re-run.

-- 1. TRUNCATE/REFERENCES/TRIGGER are never appropriate for the API roles, and RLS does
--    not gate TRUNCATE.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- 2. No direct writes on the system-owned (read-only) tables.
revoke insert, update, delete on
  public.audit_logs, public.integration_connections, public.accounting_exports,
  public.billing, public.subscriptions, public.rate_cards, public.vehicle_subscription_usage,
  public.telematics_devices, public.telematics_events, public.telematics_fuel,
  public.telematics_positions, public.telematics_trips, public.gps_events, public.vehicle_locations,
  public.tachograph_downloads, public.tachograph_infringements, public.driver_activity_logs,
  public.driver_daily_summary, public.driver_wtd_weeks
  from anon, authenticated;

-- 3. Identity/structure: no writes for the API roles (service role provisions).
revoke insert, update, delete on public.tenants, public.companies from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;  -- keep UPDATE+SELECT (guarded self-edit)
revoke all on public.profiles from anon;                            -- anon never touches profiles

-- 4. Future tables should not silently re-grant the dangerous three.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
