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
