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

(add entries here as they are found)
