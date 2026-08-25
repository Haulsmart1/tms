# Security Audit and Patch Design

**Date:** 2026-08-25
**Status:** Approved by Ethan (brainstorming session 2026-08-25)

## Goal

Run a fresh full-codebase security scan of TMS Wizzard, produce one canonical findings report, and patch every confirmed HIGH or CRITICAL finding. Mediums and below are documented and queued, not patched in this pass.

This supersedes the untracked quick pass in `SECURITY-SWEEP-2026-08-24.md` (root). That file's findings are folded into the new report and the root file is removed.

## Context

- Yesterday's targeted sweep found one confirmed HIGH: `requireTenantAccess()` in `lib/accounts/server.ts` fetches the caller's role but never enforces it, so any tenant member (including role "driver") can call every accounts, finance, Stripe Connect, and Xero route directly. It also flagged that POD share tokens cannot be revoked (no DB record, unlike `quotation_share_links`).
- Known open items from README and prior sessions, to be re-verified rather than trusted: the `job-files` Storage bucket is not locked down (unlike `pod-files`); there is no `middleware.ts` edge auth gate; there is no CSP; an invite-route `company_id` bug was flagged during the planning-page work.
- No live customers yet: production-risk objections are weighted low, but auth and data-integrity findings are weighted normally.
- `.env.local` points at the live Supabase project. Nothing in the scan or patch verification may write to it.

## Phase 1: Scan

### Surface inventory

Enumerate before auditing, and record the inventory in the report so coverage is auditable:

1. Every route handler under `app/api/`.
2. Every page under `app/` that reads or writes data.
3. Auth/tenancy/token logic in `lib/`: `lib/tenant/`, `lib/pod/`, `lib/accounts/`, `lib/api/`, `lib/roles.ts`, and the three Supabase client entry points (`lib/supabase/browser.tsx`, `server.tsx`, `admin.ts`).
4. The numbered RLS and storage-policy migrations `docs/sql/rls_01` through `rls_10`, read in order, as a dedicated pass (RLS is the actual isolation boundary).
5. Dependency and pattern surface: `npm audit`, plus grep sweeps for string-built SQL/query clauses, `dangerouslySetInnerHTML`, unescaped HTML interpolation, `admin.ts` (service-role) imports reachable from client code, and non-constant-time token comparison.

### Audit checklist (applied to every surface)

- Role and function-level authorization enforcement (the class the known HIGH belongs to).
- Tenant scoping on every query and write.
- Injection (SQL and Xero-style query-clause building).
- XSS (rendered HTML, email HTML).
- SSRF (any server route fetching a URL influenced by input).
- Open redirects.
- Token lifecycle: generation entropy, constant-time comparison, expiry, revocation.
- Secrets exposure (service-role key or API keys reachable from client bundles or responses).
- Missing rate limiting on unauthenticated endpoints.

### Method

- Parallel read-only subagents, one per surface group, each given the checklist above.
- Subagent findings are leads only. Every finding is re-verified by the main session against the actual code and either confirmed with a concrete exploit scenario (who, which request, what happens) or discarded.
- The four known open items and yesterday's two findings go through the same verification gate.

## Phase 2: Report

One committed report: `docs/superpowers/reviews/2026-08-25-security-audit.md`, containing:

1. The surface inventory (what was and was not scanned).
2. Confirmed findings ranked CRITICAL / HIGH / MEDIUM / LOW, each with file and line, exploit scenario, and proposed fix.
3. A "verified clean" list.
4. A queue section for mediums and below plus the architectural items (middleware edge auth gate, CSP, `job-files` lockdown), each near project-sized and deliberately out of scope for this patch pass.

`SECURITY-SWEEP-2026-08-24.md` is deleted from the root in the same commit.

## Phase 3: Patch

- Branch: `ethan/security-patches`.
- Scope: confirmed HIGH and CRITICAL findings only.
- One finding per plan task and per commit, ordered by severity.
- TDD where the logic is testable. Vitest only covers `lib/`, so role/authorization logic is written as pure functions in `lib/` with colocated `*.test.ts`, and route handlers call them. This matches the existing pattern in `lib/tenant/`.
- Any SQL-level fix is written as the next numbered migration in `docs/sql/` and clearly flagged as unapplied; Ethan applies it manually in the Supabase SQL editor. There is no automated migration runner.
- Completion gate for every task and for the branch: `npm run typecheck` and `npm test` both pass, with output shown.
- No writes against the live Supabase during verification. Authz fixes are verified by unit tests and code reading; signed-in checks are Ethan's call.

## Out of scope

- Patching mediums and below (documented and queued instead).
- The middleware edge auth gate, CSP, and `job-files` bucket lockdown (each gets its own future spec).
- Any exhaustive dependency upgrade beyond acting on `npm audit` HIGH/CRITICAL advisories.

## Flow after this spec

Ethan reviews this spec. On approval, the writing-plans skill produces the implementation plan covering scan tasks and patch tasks, and execution proceeds from that plan.
