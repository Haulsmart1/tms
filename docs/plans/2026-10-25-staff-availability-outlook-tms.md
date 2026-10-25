# Staff availability, Outlook calendar and TMS job-booking integration
Status: Design and implementation handoff; NOT deployed
Branch: feature/staff-availability-outlook-tms
Requested: 25 October 2026

## Goal
Allow Bob and other employees to confirm work availability from an emailed link, view the rota in a company-shared Outlook calendar, and prevent staff from being double-booked in TMS Wizard.

## Rules
- Staff enter availability, not family or childcare explanations; protect sensitive personal information.
- Unknown availability is NOT available.
- Availability != free to allocate (existing jobs and leave also count).
- All records must be tenant-scoped with Supabase RLS.
- Never silently override conflicting job assignments.
- Changes to confirmed availability flag impacted jobs and notify authorised planners.
- Staff can manage only their own availability; planners can manage allocations; all changes are auditable.

## Data model proposal
staff_availability: id, tenant_id, staff_id, start_at, end_at, status (available/unavailable/tentative), source, updated_by, updated_at, version.
staff_absence: id, tenant_id, staff_id, start_at, end_at, category (holiday/sick/other), visibility.
staff_job_assignments: id, tenant_id, staff_id, job_id, start_at, end_at, allocation_status.
staff_rota_audit: id, tenant_id, actor_id, staff_id, old_value, new_value, timestamp.
calendar_sync_links: tenant_id, staff_id nullable, provider, calendar_id, encrypted credentials reference, sync cursor.
calendar_sync_outbox: id, tenant_id, event_type, target_id, state, attempt_count, next_retry_at.

## Workflow
1. Weekly email with authenticated, expiring form link for following 4 weeks.
2. Bob selects available/unavailable/tentative and submits; system validates staff access and dates.
3. Availability updates in TMS and writes an idempotent sync event to outbox.
4. Outlook calendar sync updates tenant-owned staff rota (not personal calendars).
5. Dispatcher checks availability + existing jobs + absences in TMS job allocation.
6. Any overlap blocks confirmation or requires an explicit authorised override and reason.
7. If availability changes after booking, flag affected jobs and inform planners.
8. Office team sees only working status; limit who sees absence category.

## Implementation sequence
- Inspect existing tenant, driver, staff, job, scheduling and integration code before changing schemas.
- Write additive RLS migrations and tests; no destructive changes.
- Add staff availability API + authenticated update UI.
- Integrate with TMS job assignment validation, including concurrent bookings.
- Add email submission and reminders via existing email service.
- Integrate Microsoft Graph calendar sync using least-privilege permissions and secure token storage. Check actual Microsoft tenant eligibility and consent before enabling.
- Add reconciliation and retry logic. Test DST/British Summer Time and partial-day availability.
- Run typecheck, unit tests, migration and end-to-end checks on preview.
- Release only after explicit test/acceptance; no automatic production promotion.

## Dependencies
Bob's verified work email, authorised office users, Outlook calendar creation/sharing and Microsoft Graph permissions. Never guess identities or mark availability without his submission.
