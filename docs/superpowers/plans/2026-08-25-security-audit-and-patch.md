# Security Audit and Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a fresh full-codebase security scan of TMS Wizzard, produce one canonical committed findings report, and patch every confirmed HIGH or CRITICAL finding.

**Architecture:** Phase 1 fans out read-only audit subagents across a fixed surface inventory against a shared checklist; the main session verifies every lead before it counts. Phase 2 writes one report and retires the untracked root sweep file. Phase 3 patches HIGH/CRITICAL findings on `ethan/security-patches`, one finding per commit, extracting authorization logic into testable pure functions in `lib/` per the repo's existing `lib/tenant/` pattern.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + RLS), Vitest (covers `lib/` only), deployed on Vercel.

**Ground rules carried from the spec:**
- No writes against the live Supabase during any phase. `.env.local` points at production; verification is unit tests and code reading only.
- No em-dashes in any file this plan produces (repo convention).
- SQL-level fixes are written as the next numbered migration in `docs/sql/` and flagged unapplied; they are never auto-run.
- Completion gate for every patch task and for the branch: `npm run typecheck` and `npm test` both pass, output shown.

---

## File Structure

**Phase 1/2 (scan + report) create:**
- `docs/superpowers/reviews/2026-08-25-security-audit.md` — the canonical report.
- Deletes `SECURITY-SWEEP-2026-08-24.md` (root, untracked quick pass).

**Phase 3 (patch) creates/modifies for the known HIGH:**
- Create: `lib/accounts/authz.ts` — pure authorization decision, one responsibility.
- Create: `lib/accounts/authz.test.ts` — colocated unit tests.
- Modify: `lib/accounts/server.ts` — `requireTenantAccess` gains an `allowedRoles` option that calls the pure helper.
- Modify: each accounts/finance/stripe mutation route handler to pass the admin-only role set.

Additional patch files depend on what the report confirms and are added at the Phase 3 gate.

---

## Phase 1: Scan

### Task 1: Build and record the surface inventory

**Files:**
- Working notes only (feeds Task 6's report). No code change.

- [ ] **Step 1: Enumerate every API route**

Run: `find app/api -name "route.ts" | sort`
Expected: the ~50 route handlers (accounts/**, auth/callback, customers, driver/**, integrations/cambridge-audio, pod/share/**, public/**, request-access, settings/**, subcontractor/**, subcontractors, tomtom/**).

- [ ] **Step 2: Enumerate data-touching pages and lib modules**

Run: `find app -name "page.tsx" | sort && ls lib`
Expected: page list plus lib feature dirs (accounts, api, auth, dashboard, driver, invoices, nav, payments, planning, pod, quotations, quoteRequests, roles.ts, supabase, tenant, theme, time.ts, tomtom, tracking, validation).

- [ ] **Step 3: Enumerate SQL migrations**

Run: `ls docs/sql`
Expected: `rls_01`..`rls_10b`, plus `profiles_privileged_columns_guard.sql`, `registration_requests_rls.sql`, `schema_rls_dump.sql`.

- [ ] **Step 4: Record the inventory**

Write the three lists into a scratch note (scratchpad dir) grouped into the five surface groups below. This exact grouping is what Task 2 dispatches against and what the report's "surfaces scanned" section lists.

Surface groups:
1. Accounts / finance / payments API (`app/api/accounts/**`, `app/api/settings/payments/**`, `app/api/settings/documents/**`) + `lib/accounts/`.
2. Auth, tenancy, tokens (`app/api/auth/callback`, `app/api/settings/users/**`, `app/api/settings/portal-invites`, `app/api/subcontractor/**`, `lib/tenant/`, `lib/roles.ts`, `lib/supabase/**`, `lib/pod/`, `app/api/pod/share/**`, `app/api/public/**`).
3. Other API routes (`app/api/customers/**`, `app/api/subcontractors`, `app/api/driver/**`, `app/api/integrations/**`, `app/api/tomtom/**`, `app/api/request-access`, `lib/api/`).
4. RLS + storage migrations (`docs/sql/**`, read in numeric order).
5. Tooling sweep (`npm audit` + danger-pattern greps).

### Task 2: Dispatch parallel read-only audit subagents

**Files:** none (research task).

- [ ] **Step 1: Dispatch one Explore/general-purpose subagent per surface group 1-4**

Give each subagent this checklist and instruct it to return leads only (file, line, severity guess, one-line exploit hypothesis), not verified conclusions:
- Role / function-level authorization enforcement (is a fetched role ever actually checked?).
- Tenant scoping on every read and write.
- Injection (SQL, Xero-style query-clause building).
- XSS (rendered HTML, email HTML).
- SSRF (server routes fetching an input-influenced URL).
- Open redirects.
- Token lifecycle (entropy, constant-time compare, expiry, revocation).
- Secrets exposure (service-role key or API keys reachable client-side or in responses).
- Missing rate limiting on unauthenticated endpoints.

Seed each subagent with the known leads so they confirm or expand rather than rediscover: the `requireTenantAccess` role gap (group 1), POD share-token non-revocability (group 2), `job-files` bucket not locked down (group 4), no `middleware.ts` edge gate, no CSP, and the invite-route `company_id` bug flagged in prior planning-page work (groups 2/3).

- [ ] **Step 2: Collect subagent leads into the scratch note**

Append every returned lead under its surface group. Do not treat any as confirmed yet.

### Task 3: Tooling sweep (surface group 5)

**Files:** none (research task).

- [ ] **Step 1: Dependency advisories**

Run: `npm audit --omit=dev`
Record HIGH/CRITICAL advisories only. Note them as leads; do not upgrade anything in this plan beyond acting on confirmed HIGH/CRITICAL in Phase 3.

- [ ] **Step 2: Danger-pattern greps**

Run each and record hits as leads:
- `grep -rn "dangerouslySetInnerHTML" app lib`
- `grep -rn "createAdminClient\|SUPABASE_SERVICE_ROLE_KEY\|admin.ts" app --include="*.tsx"` (service-role reachable from client components)
- `grep -rni "select \*\|\.rpc(\|filter(\|\.or(" lib app --include="*.ts" | grep -i "req\|param\|search\|body"` (input-built query clauses)
- `grep -rn "redirect(\|Location\|next=" app/api --include="*.ts"` (open-redirect surface)
- `grep -rni "timingSafe\|=== token\|token ===\|compare" lib app --include="*.ts"` (non-constant-time compares)

### Task 4: Verify every lead

**Files:** none (verification task). This is the gate that turns leads into findings.

- [ ] **Step 1: For each lead, read the actual code and decide**

For each lead, open the cited file/line and either:
- **Confirm:** write a concrete exploit scenario (which authenticated role or anonymous caller, which exact request, what unauthorized effect) and a proposed fix. Assign severity: CRITICAL (unauthenticated data loss / cross-tenant breach / RCE), HIGH (authenticated privilege escalation or cross-tenant access), MEDIUM (needs unusual preconditions or limited impact), LOW (defense-in-depth).
- **Discard:** note one line on why it is not exploitable (e.g. RLS backstops it, input is validated, compare is already constant-time).

- [ ] **Step 2: Re-verify the six seeded known items through the same gate**

Confirm or discard each with the same rigor. The `requireTenantAccess` gap is expected to confirm as HIGH; capture its exact confirmed scenario for Task 7.

---

## Phase 2: Report

### Task 5: Write the canonical report

**Files:**
- Create: `docs/superpowers/reviews/2026-08-25-security-audit.md`

- [ ] **Step 1: Write the report**

Sections, in order:
1. **Scope and method** — the five surface groups from Task 1, the checklist, and the "leads verified individually" method. State explicitly what was not scanned.
2. **Findings** — ranked CRITICAL then HIGH then MEDIUM then LOW. Each: title, `file:line`, exploit scenario, proposed fix, severity.
3. **Verified clean** — areas checked with no action needed (carry forward yesterday's clean list only where re-verified: auth/PKCE callback, request-access rate limiting, Cambridge Audio constant-time bearer auth, customer/subcontractor tenant scoping, TomTom SSRF surface, Xero query escaping, secrets handling).
4. **Queued (not patched this pass)** — every MEDIUM and below, plus the architectural items (middleware edge auth gate, CSP, `job-files` bucket lockdown), each noted as its own future spec.

- [ ] **Step 2: Retire the root sweep file and commit**

```bash
git rm SECURITY-SWEEP-2026-08-24.md 2>/dev/null || rm -f SECURITY-SWEEP-2026-08-24.md
git add docs/superpowers/reviews/2026-08-25-security-audit.md SECURITY-SWEEP-2026-08-24.md
git commit -m "docs: add canonical 2026-08-25 security audit report; retire root quick-pass sweep"
```

Note: the root file is currently untracked, so `git rm` may fail; the `rm -f` fallback plus `git add` of its path stages the deletion cleanly whether or not it was tracked.

---

## Phase 3: Patch (HIGH/CRITICAL only)

### Task 6: Create the patch branch

**Files:** none.

- [ ] **Step 1: Branch from up-to-date main**

```bash
git checkout main && git status
git checkout -b ethan/security-patches
```

Expected: on a clean tree at the report commit, new branch `ethan/security-patches`.

### Task 7: Extract a testable role-authorization helper

**Files:**
- Create: `lib/accounts/authz.ts`
- Test: `lib/accounts/authz.test.ts`

This is the pure, unit-testable core of the known HIGH fix. `requireTenantAccess` itself hits Supabase and is not unit-testable, so the decision logic lives here (mirrors how `lib/tenant/context.ts` isolates pure logic).

- [ ] **Step 1: Write the failing test**

```ts
// lib/accounts/authz.test.ts
import { describe, it, expect } from "vitest";
import { isRoleAuthorized, ACCOUNTS_WRITE_ROLES } from "./authz";

describe("isRoleAuthorized", () => {
  it("allows any member when no allow-list is given (read semantics preserved)", () => {
    expect(isRoleAuthorized("driver", undefined)).toBe(true);
    expect(isRoleAuthorized("staff", undefined)).toBe(true);
    expect(isRoleAuthorized("admin", undefined)).toBe(true);
  });

  it("admits only listed roles when an allow-list is given", () => {
    expect(isRoleAuthorized("admin", ACCOUNTS_WRITE_ROLES)).toBe(true);
    expect(isRoleAuthorized("super_admin", ACCOUNTS_WRITE_ROLES)).toBe(true);
    expect(isRoleAuthorized("staff", ACCOUNTS_WRITE_ROLES)).toBe(false);
    expect(isRoleAuthorized("driver", ACCOUNTS_WRITE_ROLES)).toBe(false);
  });

  it("treats empty, null, and unknown roles as unauthorized under an allow-list", () => {
    expect(isRoleAuthorized("", ACCOUNTS_WRITE_ROLES)).toBe(false);
    expect(isRoleAuthorized(null, ACCOUNTS_WRITE_ROLES)).toBe(false);
    expect(isRoleAuthorized("owner", ACCOUNTS_WRITE_ROLES)).toBe(false);
  });

  it("normalizes case and surrounding whitespace before matching", () => {
    expect(isRoleAuthorized("  Admin  ", ACCOUNTS_WRITE_ROLES)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/accounts/authz.test.ts`
Expected: FAIL, cannot resolve `./authz`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// lib/accounts/authz.ts

// Roles permitted to mutate accounts/finance/payments resources.
// Matches the admin gate used in app/api/settings/users/invite/route.ts.
export const ACCOUNTS_WRITE_ROLES = ["admin", "super_admin"] as const;

export function isRoleAuthorized(
  role: string | null | undefined,
  allowedRoles?: readonly string[],
): boolean {
  if (!allowedRoles) return true; // no allow-list => any authenticated member (read semantics)
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return allowedRoles.some((r) => r.toLowerCase() === normalized);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/accounts/authz.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/accounts/authz.ts lib/accounts/authz.test.ts
git commit -m "feat(security): add pure role-authorization helper for accounts API"
```

### Task 8: Enforce the allow-list in requireTenantAccess

**Files:**
- Modify: `lib/accounts/server.ts` (`requireTenantAccess`, currently lines 47-81)

- [ ] **Step 1: Add the `allowedRoles` parameter and enforce it**

Change the signature and add the check after the membership is loaded. Current code returns as soon as a membership row exists; the new code additionally rejects roles outside the allow-list.

```ts
import { isRoleAuthorized } from "./authz";

export async function requireTenantAccess(
  tenantId: string,
  allowedRoles?: readonly string[],
) {
  const userClient = await createUserClient();

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new Error("UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  const { data: membership, error } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!membership) {
    throw new Error("FORBIDDEN");
  }

  const role = String(membership.role ?? "");

  if (!isRoleAuthorized(role, allowedRoles)) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, role };
}
```

Note: `errorResponse` already maps `FORBIDDEN` to a 403, so no change is needed there. Existing callers that pass no second argument keep today's behavior (any member), which is why every mutation call site must be updated in Task 9.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the new parameter is optional, so no existing call breaks to compile).

- [ ] **Step 3: Commit**

```bash
git add lib/accounts/server.ts
git commit -m "feat(security): let requireTenantAccess enforce an allowed-roles list"
```

### Task 9: Gate every accounts/finance/payments mutation to admin roles

**Files (modify the mutating handlers only — POST/PATCH/PUT/DELETE):**
- `app/api/accounts/credit-notes/route.ts`
- `app/api/accounts/invoices/route.ts`, `app/api/accounts/invoices/[id]/route.ts`, `app/api/accounts/invoices/[id]/email/route.ts`
- `app/api/accounts/quotations/route.ts`, `app/api/accounts/quotations/[id]/convert/route.ts`, `app/api/accounts/quotations/[id]/email/route.ts`, `app/api/accounts/quotations/[id]/share/route.ts`
- `app/api/accounts/quote-requests/route.ts`
- `app/api/accounts/payments/route.ts`
- `app/api/accounts/purchase-orders/route.ts`
- `app/api/accounts/chase-letters/route.ts`
- `app/api/accounts/statements/route.ts`
- `app/api/accounts/accounting/route.ts` and every `app/api/accounts/accounting/xero/**` route that mutates (connect, disconnect, setup, callback, invoices/[id]/sync)
- `app/api/settings/documents/route.ts`, `app/api/settings/documents/logo/route.ts`
- `app/api/settings/payments/stripe/connect/route.ts`

Leave GET handlers calling `requireTenantAccess(tenantId)` with no allow-list, preserving read access for staff/drivers. (If Task 4 confirmed any specific GET leaks sensitive data cross-role, the report will say so and that handler is added here.)

- [ ] **Step 1: Update each mutation call site**

In each listed file, for each mutating handler, change:

```ts
const { admin, user } = await requireTenantAccess(tenantId);
```

to:

```ts
import { ACCOUNTS_WRITE_ROLES } from "@/lib/accounts/authz";
// ...
const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_WRITE_ROLES);
```

(Use the import path style already present in each file — relative or `@/` alias — matching its existing imports.)

- [ ] **Step 2: Verify no mutation handler was missed**

Run: `grep -rn "requireTenantAccess(" app/api | grep -v "ACCOUNTS_WRITE_ROLES"`
Expected: only GET handlers remain in the output. Manually confirm each remaining line is a read handler.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api
git commit -m "fix(security): require admin role for accounts/finance/payments mutations"
```

### Task 10: Patch any additional confirmed HIGH/CRITICAL findings

**Files:** determined by the Task 5 report.

- [ ] **Step 1: For each additional confirmed HIGH/CRITICAL finding, append a task following the Task 7-9 template**

For each such finding, add tasks that: (a) if the fix has testable pure logic, extract it into a `lib/<feature>/` function with a colocated `*.test.ts` written test-first (Task 7 shape); (b) wire it into the route/component (Task 8-9 shape); (c) if it is SQL/RLS, write the next numbered migration `docs/sql/rls_11_<name>.sql` (or `<name>.sql` following the existing naming), flag it unapplied at the top as a comment, and do not run it; (d) gate on `npm run typecheck && npm test`; (e) one commit per finding.

Do not invent findings here. If the report confirms only the `requireTenantAccess` HIGH, this task is a no-op and the branch is complete after Task 9.

### Task 11: Finish the branch

- [ ] **Step 1: Full gate**

Run: `npm run typecheck && npm test`
Expected: both PASS, output shown.

- [ ] **Step 2: Summarize and hand off**

Report to Ethan: findings confirmed, what was patched vs queued, which SQL migrations (if any) await manual application in the Supabase SQL editor, and that no live-data verification was performed. Invoke superpowers:finishing-a-development-branch to choose merge/PR/cleanup.

---

## Self-Review Notes

- **Spec coverage:** Phase 1 scan (surface inventory + parallel audit + RLS pass as group 4 + tooling as group 5 + per-lead verification) = Tasks 1-4. Report superseding the root file = Task 5. Patch on `ethan/security-patches`, HIGH/CRITICAL only, one commit per finding, TDD via `lib/` pure functions, unapplied numbered SQL migrations, typecheck+test gate, no live writes = Tasks 6-11. All spec sections map to tasks.
- **Placeholder scan:** the only deliberately-open task is Task 10, which is contingent on scan output; it is scoped to a concrete template (Tasks 7-9) rather than left hollow, and is an explicit no-op if no further findings confirm. Real code for undiscovered bugs cannot be pre-written without violating no-placeholders; this is the honest boundary of a security-audit plan.
- **Type consistency:** `isRoleAuthorized(role, allowedRoles?)` and `ACCOUNTS_WRITE_ROLES` are defined in Task 7 and used unchanged in Tasks 8-9. `requireTenantAccess(tenantId, allowedRoles?)` returns `{ admin, user, role }` (unchanged shape plus enforced role), matching existing destructuring at call sites.
