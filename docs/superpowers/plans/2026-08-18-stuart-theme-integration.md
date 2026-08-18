# Stuart Branch Theme Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `origin/stuart-vehicle-compliance` into main via `ethan/stuart-theme-integration`, keeping Stuart's logic byte-for-byte, then restyle his five pages (pod, assets, maintenance, drivers, settings/users) to the `.ds` design system, one commit per page.

**Architecture:** A single integration branch. The merge commit takes Stuart's `app/pod/page.tsx` verbatim (the only conflict) so it contains zero hand-written lines. Each later commit is a pure restyle of one page: inline `style={styles.x}` objects are replaced with `.ds` token classes and the shared components in `components/`. Hooks, handlers, state, queries, and JSX logic do not change. Suspicious logic goes in a findings doc, never fixed here.

**Tech Stack:** Next.js 16 app router, Tailwind with CSS-variable tokens (`tailwind.config.ts` + `app/tokens.css`), shared components in `components/`, vitest (`npm test`), Playwright layout specs under `tests/` (local only, not in CI).

**Spec:** `docs/superpowers/specs/2026-08-18-stuart-theme-integration-design.md`

---

## Restyle Reference

Every restyle task follows this recipe. It is the single source of truth for conversions; the per-task sections list only what is unique to that page.

### Hard rules

1. **Logic freeze.** Do not change hooks, handlers, state shapes, queries, conditions, `useMemo` bodies, or the props wired to handlers. `value=`, `onChange=`, `onClick=`, `onSubmit=`, `disabled=` expressions move to the new elements verbatim. If something looks wrong, add a findings entry (Task 1) and move on.
2. **`.ds` wrapper is mandatory.** Tailwind preflight is OFF in this repo. `Button`, `Card`, `Field`, `Badge` all document "renders correctly ONLY inside a `.ds` wrapper". Every page shell must be `<div className="ds min-h-screen bg-canvas font-sans text-ink">`.
3. **No alpha modifiers.** Token colours are plain `var()` strings, so `bg-primary/10` or `text-ink/60` compile to NOTHING, silently (documented in `tailwind.config.ts`). Use the `*-tint` tokens instead.
4. **`Button` defaults to `type="button"`.** Stuart's submit buttons inside `<form onSubmit=...>` rely on the HTML default of `type="submit"`. When converting a submit button to `<Button>`, you MUST add `type="submit"` explicitly or the form stops submitting. Check every converted button that lives inside a form.
5. **`Button` is not disabled while loading.** The component uses `aria-busy` and expects the submit handler to guard double submission. Stuart's handlers mostly guard via state already; where a button was `disabled={saving}` keep `disabled={saving}` on the `<Button>`. That prop still works.
6. **Delete a `styles` object only after nothing references it.** Finish converting the file, then grep it for `styles.` before removing the object. Leftover references are a build error, but a leftover unused object is silent dead weight.
7. **Keep each page's existing gate wrapper** (`TenantGate`, tenant checks) exactly where it is. Adding or removing a gate is logic.

### Token map

| Stuart's inline pattern | Replacement |
|---|---|
| `<main style={styles.page}>` + `<div style={styles.shell}>` | `<div className="ds min-h-screen bg-canvas font-sans text-ink"><main className="mx-auto max-w-[1480px] px-6 py-8">` |
| eyebrow / kicker text | `<div className="text-kicker uppercase text-ink-3">` |
| `<h1 style={styles.title}>` | `<h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">` |
| subtitle paragraph | `<p className="mb-4 text-sm text-ink-3">` |
| panel / card `<section style={styles.panel}>` | `<Card>` from `components/Card.tsx`, or `<section className="rounded-lg border border-line bg-surface p-4 shadow-sm">` when the element must stay a `<section>` with an `aria-label` |
| `<h2 style={styles.sectionTitle}>` | `<h2 className="mb-1 text-md font-semibold text-ink">` (or the `kicker` prop on `Card`) |
| section description | `<p className="mb-3 text-sm text-ink-3">` |
| error banner | `<div className="mb-4 rounded-lg border border-danger-border bg-danger-tint p-3 text-sm text-danger-strong">` |
| success banner | `<div className="mb-4 rounded-lg border border-success-border bg-success-tint p-3 text-sm text-success-strong">` |
| label + `<input>` pair | `<Field id="..." label="..." value={...} onChange={...} />` from `components/Field.tsx` (props spread onto the input; `wrapperClassName` for grid spans). Field requires an `id`: derive stable ids like `asset-registration` |
| `<textarea>` | `<Textarea id="..." label="..." value={...} onChange={...} />` from `components/Textarea.tsx` (same API shape as Field: requires `id` and `label`, spreads the rest onto the textarea, `wrapperClassName` for grid spans) |
| `<select>` | no shared component exists; raw select with `className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"` |
| form grid | `<div className="grid gap-3 sm:grid-cols-2">` (span wide children with `sm:col-span-2`) |
| primary action button | `<Button type="submit">` or `<Button onClick={...}>` |
| neutral / cancel button | `<Button variant="secondary">` |
| destructive button | `<Button variant="danger">` |
| status pill | `<Badge tone={...}>` with mapping: delivered/valid/pass → `success`, pending/due-soon → `warning`, overdue/failed/VOR → `danger`, everything else → `neutral` |
| summary tile (value + label) | `<Stat label="..." value={String(...)} />` from `components/Stat.tsx`, tiles in `<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">` |
| `<table>` | keep the table, wrap in `<Card flush><div className="overflow-x-auto"><table className="w-full border-collapse text-sm">`; header cells `<th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-3">`; body cells `<td className="border-b border-line px-3 py-2 text-ink">` |

Reference implementations to imitate: `app/pod/page.tsx` on current main (page shell, banner, Stat grid) and `app/tracking/*.tsx` (cards, kickers, lists).

### Per-page verification loop

Run after converting each page, before its commit:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: typecheck clean, build succeeds, vitest suite passes with the same test count as the baseline recorded in Task 0. Then grep the page for leftovers:

```powershell
git grep -n "style={styles" -- "app/<page>/page.tsx"
git grep -n "style={{" -- "app/<page>/page.tsx"
```

Expected: no matches (a handful of `style={{...}}` survivors are acceptable ONLY for truly dynamic values like progress widths; none of these five pages has one).

---

## Task 0: Integration branch and merge

**Files:**
- No file edits by hand. Merge only.

- [ ] **Step 1: Confirm the working tree state**

```powershell
git status
```

Expected: on `main`, only the pre-existing unrelated noise (`docs/sql/schema_rls_dump.sql` modified; `docs/handoffs/`, `schema_dump.json`, `scripts/` untracked). None of these paths is touched by Stuart's branch, so they can stay. If anything under `app/` is dirty, stop and ask Ethan.

- [ ] **Step 2: Create the branch**

```powershell
git fetch origin
git checkout -b ethan/stuart-theme-integration main
```

- [ ] **Step 3: Record the vitest baseline**

```powershell
npm test
```

Write down the total test-file and test counts printed by vitest. Every later task compares against these numbers.

- [ ] **Step 4: Merge Stuart's branch**

```powershell
git merge origin/stuart-vehicle-compliance
```

Expected: exactly one conflict, in `app/pod/page.tsx`. If any OTHER file conflicts, stop: the world has changed since this plan was written, re-diagnose before resolving anything.

- [ ] **Step 5: Resolve the conflict by taking Stuart's side verbatim**

```powershell
git checkout --theirs -- app/pod/page.tsx
git add app/pod/page.tsx
git status
```

Expected: all conflicts resolved, merge ready to commit.

- [ ] **Step 6: Commit the merge**

```powershell
git commit -m @'
Merge stuart-vehicle-compliance, keeping Stuart's POD page verbatim

The only conflict was app/pod/page.tsx: main had the design-system
reskin with simple logic, Stuart had a rich rewrite (typed evidence,
multi-file upload, deletion) with inline styles. Per the approved spec
his side wins byte-for-byte here; the reskin returns in the next
commit as markup only.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [ ] **Step 7: Post-merge health check**

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all pass. Stuart's page compiled on his branch and nothing else conflicts, but this is the baseline proof that any later failure was introduced by a restyle commit, not by the merge. If typecheck fails here, record the exact errors in the findings doc (Task 1) and fix ONLY what blocks the build, as a separate commit with the reason in its message.

## Task 1: Findings doc

**Files:**
- Create: `docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md`

- [ ] **Step 1: Create the doc with the entries already known**

```markdown
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
```

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md
git commit -m @'
Start the findings log for the Stuart integration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 2: Restyle /pod

The riskiest page, done first. Stuart's page structure: h1 header, a four-tile summary grid (`SummaryCard` local component), a toolbar with a `PodFilter` select, then job sections (customer h2) containing stop articles with evidence lists and per-stop forms.

**Files:**
- Modify: `app/pod/page.tsx` (Stuart's 1,614-line version, post-merge)
- Modify: `tests/pod-layout.spec.mjs` (anchor updates only)
- Possibly delete: `app/pod/PodQueue.tsx`, `app/pod/PodRail.tsx`, `app/pod/PodForm.tsx` (Step 5 decides)

- [ ] **Step 1: Convert the page using the Restyle Reference**

Page-specific decisions:

- Replace the local `SummaryCard` component with the shared `Stat`. `SummaryCard` takes `value` and a label; `Stat` takes `label`, `value` (string), optional `sub`/`subTone`. Map: total → plain, pending → `subTone="warning"` when > 0, delivered → `subTone="positive"`, missing evidence → `subTone="danger"` with `sub="needs evidence"` when > 0. Delete the `SummaryCard` function once nothing references it.
- Tile grid: `<section aria-label="POD summary" className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">`. The `aria-label` is load-bearing: the layout spec anchors on it (Step 3).
- Toolbar: `<section className="mb-4 flex flex-wrap items-center gap-3">`, filter select per the token map, with a visible label span `className="text-sm font-medium text-ink-2"`. The select keeps its exact `value={filter}` and `onChange` handler.
- Each job section becomes `<section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">` with the customer `<h2 className="mb-2 text-md font-semibold text-ink">`.
- Each stop article becomes `<article data-stop-card className="mb-3 rounded-lg border border-line bg-surface-2 p-3">`. The `data-stop-card` attribute is load-bearing for the layout spec (Step 3).
- Give the recipient/customer display name inside each stop card `data-stress="name"` and the vehicle text `data-stress="vehicle"` (both on the innermost element holding the text). These replace the spec's `td:nth-child(n) span span` stress targets.
- Evidence rows, upload buttons, delete buttons: `Button` sizes `sm`; delete is `variant="danger" size="sm"`. Keep `window.confirm` (findings entry 3 exists; do not swap to Modal).
- Status pills → `Badge` per the token map.
- Forms per stop → `Field`/`Textarea`/select conversions per the token map, ids like `pod-<stopId>-recipient` using the stop id variable already in scope.

- [ ] **Step 2: Run the per-page verification loop**

Per the Restyle Reference: `npm run typecheck`, `npm run build`, `npm test`, then the leftover greps on `app/pod/page.tsx`. All clean, test counts equal to the Task 0 baseline.

- [ ] **Step 3: Update the layout spec anchors**

`tests/pod-layout.spec.mjs` measurement logic stays. Three anchor changes:

In `assertOnRealPage`, replace the tablist/table guard:

```js
  const hasQueue = await page.evaluate(
    () =>
      Boolean(
        document.querySelector('section[aria-label="POD summary"]') &&
          document.querySelector("main h1"),
      ),
  );
  if (!hasQueue) return "/pod rendered without its summary tiles";
```

In the main loop, replace the row count:

```js
    const rowCount = await page.evaluate(
      () => document.querySelectorAll("[data-stop-card]").length,
    );
```

Replace the stress injection block:

```js
    if (stress) {
      await page.evaluate(
        ([name, vehicle]) => {
          for (const card of document.querySelectorAll("[data-stop-card]")) {
            const n = card.querySelector('[data-stress="name"]');
            if (n) n.textContent = name;
            const v = card.querySelector('[data-stress="vehicle"]');
            if (v) v.textContent = vehicle;
          }
        },
        [LONG_NAME, LONG_VEHICLE],
      );
    }
```

Also update the empty-queue NOTE text from "queue was empty" to "no stop cards rendered", and the header comment's RUN example stays the same. The `tbody tr` collision check stays as-is: it simply measures nothing on a page without tables, and it comes back into play if a table ever returns.

- [ ] **Step 4: Sanity-run the spec unauthenticated**

```powershell
node tests/pod-layout.spec.mjs
```

Expected: exit 2 with the ABORT about `POD_AUTH_URL`. That proves the file still parses and its guard still refuses to fake a pass. The real authenticated run happens in Task 7.

- [ ] **Step 5: Deal with the orphaned pod components**

```powershell
git grep -n "PodQueue\|PodRail\|PodForm" -- "app" "lib" "components"
```

If the ONLY hits are the three component files themselves (plus `app/jobs/*` hits, which import their own StopCard, check they do not import from `app/pod/`), delete `app/pod/PodQueue.tsx`, `app/pod/PodRail.tsx`, `app/pod/PodForm.tsx` and re-run `npm run build`. If anything else imports them, leave all three in place and add a findings entry naming the importer. Do NOT touch `lib/pod/` either way: `app/dashboard/page.tsx` imports it.

- [ ] **Step 6: Commit**

```powershell
git add app/pod/page.tsx tests/pod-layout.spec.mjs
git add -A app/pod
git commit -m @'
Restyle /pod to the design system, logic untouched

Stuart's rewritten POD page keeps its logic byte-for-byte; the inline
style objects are replaced with .ds token classes, Stat, Badge, Field
and Button. The layout spec re-anchors on data-stop-card and the
summary grid because the queue table it navigated by no longer exists.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 3: Restyle /assets

Stuart's structure: header with a counter chip, error/success banners, an asset form panel (inputs, selects, textarea), and an asset register panel (list/table of assets with actions).

**Files:**
- Modify: `app/assets/page.tsx`

- [ ] **Step 1: Convert the page using the Restyle Reference**

Page-specific decisions:

- The `styles.counter` chip in the header → `<Badge tone="neutral">` with the same children.
- The two `<section style={styles.panel}>` blocks → `Card` per the token map, keeping any `aria-label`s.
- The form → `<div className="grid gap-3 sm:grid-cols-2">` inside the card; every label+input pair → `Field` with ids prefixed `asset-`; selects and the textarea per the token map. The `<form onSubmit={...}>` element and its handler are untouched.
- Submit button inside the form: `<Button type="submit" disabled={...}>` with the exact existing disabled expression (hard rule 4).
- The register's per-asset action buttons (edit, delete, and similar) → `Button size="sm"` with `secondary`/`danger` variants, handlers untouched.

- [ ] **Step 2: Run the per-page verification loop** (Restyle Reference), leftover greps on `app/assets/page.tsx`.

- [ ] **Step 3: Commit**

```powershell
git add app/assets/page.tsx
git commit -m @'
Restyle /assets to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 4: Restyle /maintenance

Stuart's structure: header, a VOR panel, a record form card (inputs, selects, textarea), and a records section with inline per-record editing (nested selects and textareas inside each record).

**Files:**
- Modify: `app/maintenance/page.tsx`

- [ ] **Step 1: Convert the page using the Restyle Reference**

Page-specific decisions:

- VOR panel: this is a warning surface. Use `<section aria-label="Vehicles off road" className="mb-4 rounded-lg border border-warning-border bg-warning-tint p-4">` with heading `<h2 className="mb-2 text-md font-semibold text-warning-strong">`. If the panel renders a danger state (vehicle off road now), the row-level pills use `Badge tone="danger"`.
- The record form card and its fields per the token map, ids prefixed `maint-`.
- The per-record inline edit controls keep their exact conditional rendering (`editingId === record.id` style conditions are logic); only the elements inside each branch get converted.
- Record rows: if rendered as a list, each row `<article className="mb-2 rounded-lg border border-line bg-surface-2 p-3">`; if a table, the table treatment from the token map.

- [ ] **Step 2: Run the per-page verification loop**, leftover greps on `app/maintenance/page.tsx`.

- [ ] **Step 3: Commit**

```powershell
git add app/maintenance/page.tsx
git commit -m @'
Restyle /maintenance to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 5: Restyle /drivers

The page already has local `Section` and `SelectField` helper components, so most of the conversion happens once inside those helpers rather than at every call site.

**Files:**
- Modify: `app/drivers/page.tsx`

- [ ] **Step 1: Convert the page using the Restyle Reference**

Page-specific decisions:

- Convert the local `Section` helper to render `<section className="rounded-lg border border-line bg-surface p-4 shadow-sm">` with `<h2 className="mb-3 text-md font-semibold text-ink">{title}</h2>`. All call sites (`Driver Profile`, `Driving Licence`, `Tachograph`, `CPC & ADR`, `Medical & Right to Work`, `Emergency Contact & Notes`) inherit it for free.
- Convert the local `SelectField` helper's markup to the Field label classes plus the select classes from the token map. Its props and handler wiring stay identical.
- Any remaining raw label+input pairs outside the helpers → `Field` with ids prefixed `driver-`.
- Compliance warning rows (expiry warnings with dates) → `Badge` tones: expired `danger`, expiring soon `warning`, valid `success`.
- The page shell, banners, and Driver Records section cards per the token map.

- [ ] **Step 2: Run the per-page verification loop**, leftover greps on `app/drivers/page.tsx`.

- [ ] **Step 3: Commit**

```powershell
git add app/drivers/page.tsx
git commit -m @'
Restyle /drivers to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 6: Restyle /settings/users

Stuart's structure: header, an Invite User form card (email input, role selects), and a user list with per-user editing that calls his new API route. The API route file is not touched.

**Files:**
- Modify: `app/settings/users/page.tsx`

- [ ] **Step 1: Convert the page using the Restyle Reference**

Page-specific decisions:

- This page names its style objects individually (`pageStyle`, `overlayStyle`, `titleStyle`, `cardStyle`, `formGridStyle`, `fieldStyle`, `labelStyle`), not a single `styles` object. The leftover greps in Step 2 must therefore also cover them:

```powershell
git grep -n "Style}" -- "app/settings/users/page.tsx"
```

- Invite form → `Card` with `<div className="grid gap-3 sm:grid-cols-2">`, email input → `Field id="invite-email"`, role selects per the token map, submit → `<Button type="submit">` (hard rule 4).
- The `<h2 style={{ marginTop: 0 }}>` → `<h2 className="mb-3 mt-0 text-md font-semibold text-ink">`.
- Per-user rows: `<article className="mb-2 rounded-lg border border-line bg-surface-2 p-3">`, role/status pills → `Badge`, action buttons → `Button size="sm"` variants, all handlers untouched.

- [ ] **Step 2: Run the per-page verification loop**, leftover greps on `app/settings/users/page.tsx` including the `Style}` grep above.

- [ ] **Step 3: Commit**

```powershell
git add app/settings/users/page.tsx
git commit -m @'
Restyle /settings/users to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 7: Full verification

**Files:**
- Modify: `docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md` (final entries, if any)

- [ ] **Step 1: Whole-branch checks**

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all clean, vitest counts equal to the Task 0 baseline (or baseline minus deleted-orphan tests IF Step 5 of Task 2 deleted components that had tests; record the delta and why in the findings doc).

- [ ] **Step 2: Restyle-purity audit**

```powershell
git diff main...HEAD --stat
git grep -n "style={styles\|Style}" -- "app/pod/page.tsx" "app/assets/page.tsx" "app/maintenance/page.tsx" "app/drivers/page.tsx" "app/settings/users/page.tsx"
```

Expected: the diff touches only the merged files, the five pages, the pod layout spec, and the two docs; the grep is empty.

- [ ] **Step 3: Layout specs, authenticated (local dev server, live-data caution)**

WARNING per memory: `.env.local` points at the LIVE Supabase. The specs only measure geometry and never submit forms, and dev-login is the established practice here, but do not click around beyond what the specs do.

```bash
# in Git Bash, dev server already running in another terminal (npm run dev)
LINK=$(node scripts/dev-login.mjs <email> /pod | grep -o 'http://[^ ]*')
POD_AUTH_URL="$LINK" node tests/pod-layout.spec.mjs

LINK=$(node scripts/dev-login.mjs <email> /tracking | grep -o 'http://[^ ]*')
TRACKING_AUTH_URL="$LINK" node tests/tracking-layout.spec.mjs
```

Expected: both exit 0. The tracking spec is included because the merge must not have disturbed /tracking; it should pass untouched. If either fails, fix layout (markup only) and re-run before proceeding.

- [ ] **Step 4: Commit any findings-doc additions**

```powershell
git add docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md
git commit -m @'
Record findings from the Stuart integration restyle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

(Skip if the doc gained nothing since Task 1.)

- [ ] **Step 5: Hand off**

Do not merge to main or push inside this plan. Report status to Ethan and use the superpowers:finishing-a-development-branch skill to decide merge/PR. Ethan's signed-in manual pass joins the existing sign-off queue.
