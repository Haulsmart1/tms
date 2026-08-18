# Stuart Branch Theme Integration

**Date:** 2026-08-18
**Branch:** `ethan/stuart-theme-integration`
**Source branch:** `origin/stuart-vehicle-compliance` (tip `01b1e89`)

## Background

Stuart's `stuart-vehicle-compliance` branch forked from main at `84b2fdc` (his Xero/accounts merge, 2026-08-14), before the tracking console rebuild (`212726c`) and the POD console redesign (`aa6c89f`) were merged. Consequences:

- The tracking page was never removed. His branch simply predates the rebuild and does not touch `app/tracking/*`. Merging keeps main's tracking console intact.
- His branch rewrites `app/pod/page.tsx` (1,614 lines, rich logic: typed evidence, multi-file upload with MIME and size validation, evidence deletion, tenant context) against the pre-redesign page. It conflicts with main's redesigned page (318 lines, design-system markup, simple logic with `any` types). This is the only merge conflict.
- All five pages he touched (pod, assets, maintenance, drivers, settings/users) use hardcoded inline `style={styles.x}` objects and are off-theme. Main's own copies of maintenance and drivers are also inline-styled, so this project extends the `.ds` design system across the whole fleet/compliance surface, not just his new commits.
- His other changes merge cleanly: `app/assets/page.tsx`, `app/maintenance/page.tsx`, `app/drivers/page.tsx`, `app/settings/users/page.tsx`, and a new API route `app/api/settings/users/[userId]/route.ts`.

## Decisions (locked with Ethan, 2026-08-18)

1. **POD base:** Stuart's page is the logic base. Its markup is rewritten with `.ds` token classes. Main's redesigned page is retired but serves as the visual reference.
2. **Scope:** all five pages are restyled in this project.
3. **Logic freeze:** Stuart's logic ships unchanged. Suspicious findings are logged, not fixed.
4. **Execution:** Approach 1, a single integration branch, merge first, then restyle page by page.

## Design

### 1. Branch and merge mechanics

- Create `ethan/stuart-theme-integration` from up-to-date main.
- Merge `origin/stuart-vehicle-compliance`. Resolve the single conflict in `app/pod/page.tsx` by taking Stuart's side verbatim. The merge commit contains zero hand-written lines and is auditable as "Stuart's branch, unmodified".

### 2. Restyle treatment, one commit per page

Order: pod, assets, maintenance, drivers, settings/users (riskiest first).

Per page:

- Wrap the page in the `.ds` root (`ds min-h-screen bg-canvas font-sans text-ink`) and rebuild markup with the token classes used on main's /tracking and /pod (`bg-surface-2`, `border-line`, `text-ink-3`, `text-kicker`, and friends).
- Delete each dead `styles` object only once nothing references it.
- JSX structure may change (that is markup). Hooks, handlers, state, queries, and JSX logic (conditions, maps, props wired to handlers) do not change. Every interactive element keeps its exact handler and its disabled and loading semantics.
- For /pod, main's retired 318-line reskin is the layout reference (summary tiles, card grid). No logic is copied from it.

### 3. Logic freeze and findings doc

- Findings go to `docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md`, one entry per suspicious thing noticed while restyling (POD save-path drift versus the 2026-08-14 data-gap notes, `any` types, missing tenant checks, and so on).
- Nothing in the findings doc is fixed on this branch.

### 4. Verification

- After every page commit: `npm run build` and the existing unit test suite.
- New layout regression spec for /pod modeled on `tests/tracking-layout.spec.mjs`.
- Before merge to main: full build, tests, and layout specs.
- Ethan's signed-in manual pass happens after merge and joins the existing sign-off queue (tracking console, POD redesign, dark theme).

### 5. Out of scope

- Fixes from the findings doc.
- Theming pages Stuart did not touch.
- Changes to his API route logic.
- Reconciliation with main's retired pod logic.
