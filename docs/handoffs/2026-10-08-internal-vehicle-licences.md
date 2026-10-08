# Free internal vehicle licences — implementation and release handoff

Base: stu-development / 0bf41dc4d597602223ade09c8878aac6e9f2c397 (tested Bob fix).
Working branch: fix/internal-vehicle-licences. No SevenDay recovery files were
available in this checkout and none are included in the change.

## Implementation

- Immutable `billing_mode` (`paid` by default, or `internal`) on licences.
- Internal authoriser profile, timestamp and reason, retained for audit.
- An RLS-preserving `billable_vehicle_licences` view excludes internal rows
  from v1 counts, v2 lifecycle invoices and billing/reporting pages.
- Operational validation still requires an actual active licence.
- Platform-super-admin-only grant endpoint and idempotent service-only RPC.
- Internal activation/deactivation returns before any billing, payment or
  period code executes. Additional compliance documents inherit the exemption.
- Paid history cannot be reclassified or mixed with internal history.
- Licence cards distinguish free internal vehicles and display the reason.

## Validation

- Full Vitest suite: 2,826 passed in 239 files.
- Targeted initial billing suite: 53 passed; final new-feature suite: 10 passed.
- Isolated PostgreSQL: 22 checks passed, including tenant RLS, authorisation,
  immutable history, idempotency, billing exclusion and rollback. Fixture IDs
  are synthetic; these checks never touch production.
- Typecheck: passed with zero errors.
- Initial build: compilation and TypeScript passed; prerender refused because
  this checkout has no public Supabase environment configuration.
- A second isolated build with non-production placeholder public Supabase
  configuration passed. No production credentials or data were used.

## Production observations — read-only, 8 October 2026

The saved HT21 EOR lane contains 25 jobs. All 25 production job rows now name
Bob and HT21 EOR, use the saved 8 October planning date, and have route_order
1 through 25 exactly matching the saved lane. The day-query used by the
driver API returns 25 jobs with zero jobs outside that saved route. It starts
RTNMUK10186, RTNMUK10160, RTNMUK10321, RTNMUK09904.
This is database verification, not an authenticated live dashboard check.
The active vehicle_assignment still names Bob's previous vehicle, and
HT21 EOR has no active licence as observed before these code changes.
No production data was changed by this session.

## Release blocked

Vercel identified by the Bob commit's successful GitHub deployment status is
project tms under wizards-42eec65e (team_Zb399SLIr4CmG7WtWEPpOPag). The connected
Vercel tools return 403 for that scope; the CLI has no authenticated session.
Automatic approval review rejected uploading the code to public Haulsmart1/tms
as source disclosure without explicit authorisation for this implementation.
No remote branch update or production deployment occurred.

## Remaining authorised release steps

1. Resolve the GitHub public-source upload review and Vercel scope access.
2. Apply prodfix_99 once, using either the documented SQL or the corresponding
   generated migration, not both. Existing licences stay paid.
3. Deploy and verify this exact implementation before granting an internal
   licence; old deployed code would count it as paid.
4. Snapshot HT21 EOR's existing licence rows and Bob's current vehicle
   assignments. Resolve the authorising platform profile from the authenticated
   session; never infer it from an unrelated assignment's created_by.
5. Call the supported internal grant endpoint/RPC for HT21 EOR with Stuart's
   authorisation reason, then the supported assign_driver_to_vehicle operation.
   Do not change any saved-plan or job rows: their order is already correct.
6. Check licence classification, billing count/invoice exclusion, absence of
   new charges/invoices/periods/subscriptions, and Bob's authenticated live
   driver result. Confirm all 25 references in saved order and zero stale jobs
   in the active route. Retain the existing recent-history section as history.

## Rollback

Snapshot-based restore of Bob's assignment and deactivation of the newly
granted internal licence. Keep the audit row and additive schema. Deactivate
internal licences introduced by this release BEFORE reverting application
code: old code bills every active licence. No old invoice or paid lifecycle
history is changed by this implementation.
