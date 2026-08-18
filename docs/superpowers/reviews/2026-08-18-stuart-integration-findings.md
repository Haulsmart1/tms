# Stuart Integration Findings

Logged while restyling `ethan/stuart-theme-integration`. Nothing here is
fixed on that branch (spec: logic freeze). Each entry: file, what was
seen, why it matters, suggested follow-up.

## Known before the restyle started

### 1. POD save paths still disagree
`docs/superpowers/` data-gap notes from 2026-08-14 flagged that POD save
paths disagree across the app. Stuart's rewritten `app/pod/page.tsx`
adds a third variant (multi-file evidence rows). Needs one reconciled
save path.

### 2. Main's retired POD logic had a job-completion cascade
The retired reskin page marked the parent job `completed` when every
delivery stop was delivered. Stuart's page has its own version of this
cascade; verify they agree with each other and with the driver app.

### 3. `window.confirm` for destructive deletes
Stuart's evidence deletion uses `window.confirm`. Fine for now, but the
design system has `Modal`; consistency pass later.

## Logged during the restyle

### 4. Dead code: `getJobForStop`
`app/pod/page.tsx` defines `getJobForStop` but never calls it (true of
Stuart's original too). Remove when the freeze lifts.

### 5. Search input has no accessible name
`app/pod/page.tsx` toolbar search input (~line 691) has a placeholder
but no label or aria-label. Carried from Stuart's version; add an
aria-label when the freeze lifts.

### 6. Hidden file inputs have no accessible name
`app/pod/page.tsx` EvidenceUpload's hidden file inputs carry no
accessible name; the visible trigger button mitigates. Carried
verbatim.

### 7. EvidenceUpload derives its label by string comparison
`app/pod/page.tsx` EvidenceUpload picks its button label by comparing
`title === "Delivery Photos"`. Brittle; should be a prop. Carried
verbatim.

### 8. StatusBadge has no danger branch
`app/pod/page.tsx` StatusBadge renders failed or overdue stops as
neutral. Faithful to Stuart's color mapping, which had no danger color
either; add a danger tone when the freeze lifts.

### 9. Summary Stat tiles: subTone without sub renders nothing
The plan prescribed `subTone` props on the Pending and Delivered tiles
without `sub` text, which `Stat` never renders. Fixed in the review
follow-up commit by adding presentational sub text.

### 10. /assets bypasses the tenant switcher
`app/assets/page.tsx` never uses TenantGate or useTenant; it resolves
tenant from a direct `profiles` lookup, so it shows the profile's home
tenant regardless of the active-tenant selection. Inconsistent with
/pod. Carried under the freeze; needs the tenant-context treatment.

### 11. `asset_types` queried without a tenant filter
`app/assets/page.tsx` selects `asset_types` with no `.eq("tenant_id",
...)`. If that table is tenant-scoped, RLS is the only guard. Verify
the RLS policy or add the filter when the freeze lifts.

### 12. Unknown asset status renders green
`app/assets/page.tsx` `statusTone` falls through to `success` for any
status other than `inactive`/`maintenance`, exactly like Stuart's color
mapping. If statuses ever arrive from outside this form's three
options, green is misleading; default should become `neutral`.

### 13. Save/error banners have no live region
The converted pages' success and error banners (pod, assets, and the
pattern Tasks 4-6 will repeat) have no `role="status"`/`aria-live`, so
screen readers announce nothing on save or failure. Stuart's originals
had none either. One shared banner component would fix every page.

### 14. Select markup is duplicated, not shared
The raw-select class string now exists at four call sites across /pod
and /assets and will multiply through Tasks 4-6. Extract a shared
`components/Select.tsx` (Field-like API) after the freeze, then swap
the call sites in one pass.

### 15. Saving buttons swap labels instead of using Button's loading prop
/pod, /assets and /maintenance all keep Stuart's `disabled={saving}` plus
a "Saving..." label swap. Button documents a `loading` prop existing to
avoid the focus drop and width jump this causes. Family-wide cleanup
when the freeze lifts.

### 16. Inline edit forms do not manage focus
/maintenance (and the same pattern elsewhere) reveals its per-record
edit form without moving focus into it. Same behavior as Stuart's
original; family-wide a11y pass candidate.

### 17. Maintenance edit-status select offers 3 options, create offers 6
`app/maintenance/page.tsx`: pre-existing logic, frozen. Verify which
list is right when the freeze lifts.

### 18. Maintenance record detail cells squeeze at the card floor
`grid-cols-3` detail cells hit ~82px at the 300px card minimum, wrapping
kickers onto three lines; /assets uses `grid-cols-2` for the same
treatment. Stuart-faithful; cosmetic.

### 19. Stat could grow a valueTone prop
/maintenance hand-builds its Fleet/VOR stat cards because `Stat`
hard-codes the value color. A `valueTone` prop would let stat cards
with conditional value color use the shared component.
