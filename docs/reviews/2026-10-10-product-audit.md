# TMS product audit — 2026-10-10

Baseline: clean integration/operational-baseline at 9cb0603. 57 page sources inspected. This is a source inventory, not a signed-in browser certification. Static findings are prompts for review, not proof of a broken control. Runtime console, keyboard, mobile and offline verification against live accounts is deliberately not attempted. Existing Driver PWA, SevenDay Planning, driver-aware scheduling and both billing models must be preserved.

## Priorities and actions

1. Shared Modal declares aria-modal but does not contain keyboard focus: fix containment and restore focus.
2. Shared Button advertises loading but still invokes onClick: block repeated activation without losing keyboard focus.
3. Console sidebar has fixed 220px width on every viewport: add an accessible mobile disclosure.
4. Settings promises page-permission management even though grants are disabled: correct language, show authoritative role boundaries.
5. Integrations are scattered in accounts/settings: add a central registry and honest Settings → Integrations catalogue.
6. Contextual advisory assistance is missing: add permission-scoped, read-only context and a provider-neutral boundary, with local deterministic guidance.
7. Debbie has no contract: add versioned proposal/customer-mapping/idempotency contracts and a mock only. No cross-database coupling.
8. Compliance provenance is scattered: inventory rules, add effective-dated source records and explicitly distinguish law/policy/guidance/unverified. Do not alter uncertain regulatory semantics.

## Every page

Purpose follows its route; primary/secondary tasks below are extracted controls where available. Across all rows, duplicate control semantics, empty states, validation, focus, responsiveness, and contextual-assistant opportunities need entity-specific browser review. Assistant context is appropriate on office operations/commercial pages; driver/public/recipient/admin pages must not automatically share data. Existing README carries the deeper feature inventory.

| Route / purpose | User | Primary task | Secondary tasks | Source findings / verification needs |
| --- | --- | --- | --- | --- |
| /acceptable-use | Public | View acceptable-use | See linked workflow | Shared/static presentation; runtime verification pending |
| /accessibility | Public | View accessibility | See linked workflow | Shared/static presentation; runtime verification pending |
| /assets | Office | View assets | See linked workflow | Preserve tenant gate/RLS |
| /auth/confirm | Public | Continue to TMS Wizzard | See linked workflow | Raw controls: review hierarchy |
| /cancellation-policy | Public | View cancellation-policy | See linked workflow | Shared/static presentation; runtime verification pending |
| /cookies | Public | View cookies | See linked workflow | Shared/static presentation; runtime verification pending |
| /customers | Office | Cancel | See linked workflow | Keep consequential confirmation |
| /dashboard | Office | View dashboard | See linked workflow | Preserve tenant gate/RLS |
| /dpa | Public | View dpa | See linked workflow | Shared/static presentation; runtime verification pending |
| /driver/dashboard | Driver | View dashboard | See linked workflow | Shared/static presentation; runtime verification pending |
| /driver/jobs/[jobId] | Driver | dismissRejected(r.id) | cameraInputRef.current?.click(), photoInputRef.current?.click(), void completeDelivery() | Raw controls: review hierarchy |
| /driver/walkaround | Driver | void submit()}> | See linked workflow | Raw controls: review hierarchy |
| /drivers | Driver | Cancel | void unassignVehicle(selectedVehicle.id), void recordLicenceCheck(selectedDriver), void addEndorsement()}, void deleteEndorsement(item) | Preserve tenant gate/RLS; Keep consequential confirmation |
| /invoices | Office | Cancel Edit | void editCreditNote(note)}, void creditNoteAction(note, "approve")}, void creditNoteAction(note, "cancel")}, Connect Xero | Table: verify mobile scroll; Preserve tenant gate/RLS; Keep consequential confirmation; Accounting proposal handoff/status missing; preserve ledger authority |
| /jobs | Office | setJobFilters((current) => ( | setJobFilters(, sendToPlanning(selectedJob), startEdit(selectedJob), requestDelete(selectedJob) | Table: verify mobile scroll; Preserve tenant gate/RLS |
| /legal | Public | View legal | See linked workflow | Shared/static presentation; runtime verification pending |
| /load-transfer | Office | Clear batch | Add scan, removeScan(value), Confirm transfer | Raw controls: review hierarchy; Preserve tenant gate/RLS |
| /login | Public | Send login link | See linked workflow | Shared/static presentation; runtime verification pending |
| /maintenance | Office | void returnVehicleToService( | void returnVehicleToService(, void placeVehicleVor(, beginEditRecord(record), void saveEditRecord( | Preserve tenant gate/RLS; Keep consequential confirmation |
| / | Public | View product | See linked workflow | Shared/static presentation; runtime verification pending |
| /planning | Office | Check all | Clear, Send selected to vehicle, job.status !== "pending_acceptance"), optimizeAbort.current?.abort()} | Raw controls: review hierarchy; Table: verify mobile scroll; Preserve tenant gate/RLS; Keep consequential confirmation |
| /pod | Office | setExpandedJobId((current) => | void viewSharedPod(, void downloadPodPdf(, void copyPodShareLink(, void revokePodShares( | Preserve tenant gate/RLS; Keep consequential confirmation |
| /pod/share/[token] | Link recipient | View [token] | See linked workflow | Shared/static presentation; runtime verification pending |
| /privacy | Public | View privacy | See linked workflow | Shared/static presentation; runtime verification pending |
| /quotation/share/[token] | Link recipient | View [token] | See linked workflow | Table: verify mobile scroll |
| /security | Public | View security | See linked workflow | Shared/static presentation; runtime verification pending |
| /settings/billing | Company admin | View billing | See linked workflow | Preserve tenant gate/RLS |
| /settings/company | Company admin | View company | See linked workflow | Preserve tenant gate/RLS |
| /settings/documents | Company admin | void removeLogo() | void save() | Shared/static presentation; runtime verification pending |
| /settings/integrations | Company admin | View integrations | See linked workflow | Shared/static presentation; runtime verification pending |
| /settings/invoices | Company admin | View invoices | See linked workflow | Preserve tenant gate/RLS |
| /settings/licences | Company admin | View licences | See linked workflow | Preserve tenant gate/RLS; Keep consequential confirmation |
| /settings | Company admin | View settings | See linked workflow | Shared/static presentation; runtime verification pending |
| /settings/permissions | Company admin | View permissions | See linked workflow | No loading signal in page source; Unavailable grant controls correctly removed; misleading Settings description |
| /settings/portal-invites | Company admin | void send( | void send( | Shared/static presentation; runtime verification pending |
| /settings/users | Company admin | View users | See linked workflow | Preserve tenant gate/RLS; Keep consequential confirmation |
| /settings/walkaround | Company admin | Save | patchItem(item.id,, Add item | Table: verify mobile scroll |
| /shifts | Office | View shifts | See linked workflow | No loading signal in page source; Preserve tenant gate/RLS |
| /signup | Public | View signup | See linked workflow | Shared/static presentation; runtime verification pending |
| /stats | Office | setPeriod( | See linked workflow | Raw controls: review hierarchy; Table: verify mobile scroll; Preserve tenant gate/RLS |
| /sub-processors | Public | View sub-processors | See linked workflow | Shared/static presentation; runtime verification pending |
| /subcontractor/dashboard | Subcontractor | void inviteEmployee()} | See linked workflow | Raw controls: review hierarchy |
| /subcontractors | Subcontractor | Cancel | Cancel, startEditEmployee(employee)}, startEditVehicle(vehicle)} | Preserve tenant gate/RLS |
| /super-admin/billing | Platform admin | View billing | See linked workflow | Preserve tenant gate/RLS |
| /super-admin/companies/[id] | Platform admin | load()}> | renameTenant(tenant)}, openMove(tenant)}, load()} disabled=, Cancel | Preserve tenant gate/RLS |
| /super-admin/companies | Platform admin | View companies | See linked workflow | Preserve tenant gate/RLS |
| /super-admin/invoices | Platform admin | markStatus(invoice.id, "paid")} | markStatus(invoice.id, "pending")} | Preserve tenant gate/RLS |
| /super-admin | Platform admin | View super-admin | See linked workflow | Preserve tenant gate/RLS |
| /super-admin/requests | Platform admin | View requests | See linked workflow | Preserve tenant gate/RLS |
| /super-admin/users | Platform admin | View users | See linked workflow | Shared/static presentation; runtime verification pending |
| /support-policy | Public | View support-policy | See linked workflow | Shared/static presentation; runtime verification pending |
| /tachograph | Office | Cancel edit | void providerAction("test"), void providerAction("sync"), void loadLogs()}, editActivity( | Preserve tenant gate/RLS; Keep consequential confirmation |
| /telematics | Office | onSelect(vehicle.id) | See linked workflow | Raw controls: review hierarchy; Table: verify mobile scroll; Preserve tenant gate/RLS |
| /terms | Public | View terms | See linked workflow | Shared/static presentation; runtime verification pending |
| /track/[token] | Link recipient | View [token] | See linked workflow | Shared/static presentation; runtime verification pending |
| /tracking | Office | setReloadToken((t) => t + 1)} | See linked workflow | Raw controls: review hierarchy; Preserve tenant gate/RLS |
| /vehicles | Office | Cancel Policy Edit | startEditFleetPolicy(policy)}, void deactivateFleetPolicy(policy)}, Cancel | Preserve tenant gate/RLS; Keep consequential confirmation |
