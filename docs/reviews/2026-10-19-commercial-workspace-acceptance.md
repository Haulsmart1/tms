# TMS commercial workspace — review and acceptance

## Scope and release boundary

Read-only production checks and source inspection on 19 October 2026. This is an integrated **inside-the-app** review upgrade, not a production release or a claim that Danielle's login is fixed. Existing driver evidence protections must remain intact.

- Production/main: `5ea260efaa1cbb9f1e6d52c0240328b725c57323`.
- Production deployment: `dpl_DqGfv2oVXjyjj7CaFCJTCCEJsfhC`, reported `READY` by Vercel.
- PR37 evidence candidate: `d86ded8ab1933eb4208662b8dac13c8c0754e85c`.
- PR38 contains PR37 plus bounded tenant lookup: `0544315910d45aacf3f830e30a7447409ee9ba55`.
- PR38 deployment: `dpl_G7jVvk832opaDotAYEKCSk1Lxs7a`, reported `READY`; https://tms-cjh5u8pop-wizards-42eec65e.vercel.app.
- A READY build is not hosted sign-in, tenant isolation or offline evidence acceptance.

## Fresh read-only findings

GitHub main and the latest production/PR38 deployment SHAs remained as listed above during this review. The connected TMS Supabase project `llxliojjtofqdmddbdud` reported `ACTIVE_HEALTHY`.

Direct hosted requests were made without credentials, OTPs or stored user cookies:

| Request | Observed response | Interpretation |
| --- | --- | --- |
| `https://tmswizard.cloud/login` | 200; `Cache-Control: private, no-store` | Login HTML reachable; not authenticated acceptance. |
| `https://tmswizard.cloud/dashboard` | 307 to `/login?next=%2Fdashboard` | Expected protected-route response without a session. |
| `https://tmswizard.cloud/auth/confirm` | 200; incomplete/invalid-link state; private/no-cache/no-store | Token-free confirmation route reachable; no token consumed. |
| `https://www.tmswizard.cloud/login` | 307 to `https://tmswizard.cloud/login` | Canonical apex redirect observed. |

No `Set-Cookie` header was present on these unauthenticated responses. No application-error marker was observed in the returned HTML. No unauthenticated redirect cycle was reproduced. None of these observations proves that a real user's session survives the callback and dashboard load.

Vercel environment **metadata only**, with `decrypt: false`, showed `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` present for production and preview. Values and runtime correctness were not verified. `NEXT_PUBLIC_SITE_URL` was absent from the metadata; source falls back to the canonical `https://tmswizard.cloud` origin in production, so absence alone is not a demonstrated defect.

Production error/fatal runtime logs, grouped by request path over the preceding two hours, returned no groups. Log silence is not evidence of Danielle's successful sign-in.

## Auth source findings and limits

- The callback collects Supabase SSR cookie writes and copies them onto its final redirect. Browser and server clients use the default SSR cookie configuration.
- `/login`, `/auth/confirm` and the two authentication API entry routes bypass proxy session refresh, while protected routes still validate the user.
- TenantGate redirects when the provider reports signed-out. A failed tenant lookup renders recovery rather than treating the failure as a missing company.
- PR38 bounds `getUser` and tenant RPC waits separately and exposes retry. The deadline does **not** cancel SDK network/auth-lock work or prove the cause of the reported production loop.
- The repository magic-link template uses `.SiteURL`. The actual hosted email template/SiteURL was not verified by these checks.
- The checks did not request a login email, consume an OTP, recreate an account, change a role or clear browser/offline storage.

## Integrated internal workspace review

Branch `review/tms-commercial-workspace-20261019` starts from PR38 and therefore contains PR37's evidence candidate plus PR38's bounded tenant lookup. Its intended draft-PR target is `main`; no merge is authorized. GPS PR24/PR28 remain excluded and release-blocked unchanged.

The isolated review upgrade covers the application shell/navigation, dashboard operations summary and jobs table, jobs/loads workflow presentation, load-transfer workspace, and driver barcode/collection/POD presentation. Existing functional handlers and evidence/queue ownership are preserved; no replacement dummy data or bypassed tenancy/authentication is introduced.

### Changed-file inventory

Twelve runtime UI files:

- `app/components/AppShell.tsx`
- `app/components/operationsNavigation.ts`
- `app/components/operationsShell.module.css`
- `app/dashboard/page.tsx`
- `components/dashboard/TodayJobsTable.tsx`
- `app/jobs/page.tsx`
- `app/driver/jobs/[jobId]/BarcodeVerification.tsx`
- `app/driver/jobs/[jobId]/CameraBarcodeScanner.tsx`
- `app/driver/jobs/[jobId]/page.tsx`
- `app/globals.css`
- `app/load-transfer/page.tsx`
- `app/load-transfer/load-transfer.module.css`

Five test files:

- `lib/dashboard/operationsWorkspace.test.ts`
- `lib/dashboard/todayJobsTable.test.ts`
- `lib/driver/operationalWorkflowUi.test.ts`
- `lib/loadTransfers/workflowUi.test.ts`
- `lib/nav/operationsShell.test.ts`

Together with this review document, the upgrade changes 18 files.

### Executed verification

- `npm test -- --reporter=dot`: **PASS — 290 files, 3,315 tests**, including 27 new actual React server-rendering/navigation checks.
- Independent focused verification: **PASS — 135 tests**.
- `npm run typecheck`: **PASS** in helper and final coordinator verification; final `git diff --check`: **PASS** (exit 0).
- `node scripts/verify-build-offline.mjs`: **PASS**, after the build exposed and the implementation corrected an impure CSS-module selector. This is an offline verification build with inert Supabase fixtures, substitute fonts and Webpack; it is **not** a deployment artifact or hosted backend acceptance.

The new candidate commit and clickable preview are pending the coordinator's final result. The existing PR38 preview above is baseline evidence, **not** a preview of this new internal upgrade.

A real-browser request to production `/dashboard` reached login without an authenticated session. No hosted internal visual, real authenticated dashboard, production workflow, or offline-device acceptance is claimed from that observation or from the local rendering tests.

## One essential production acceptance blocker

**A real authenticated browser attempt has not been traced and accepted.** A sanitized trace of the failing attempt must distinguish OTP verification, callback cookie retention, the next protected request, and tenant-context resolution. Record only safe host/path/status/timing and whether cookies exist, never full token URLs or cookie values. An approved real-user acceptance session must reach the correct tenant workspace and remain signed in after reload; production must not be called fixed before this succeeds.

No merge, production deployment, schema/data/config write, credential change, customer communication or offline queue/evidence clearing is authorized by this review.
