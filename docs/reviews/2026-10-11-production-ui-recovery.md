# Production UI source-composition recovery

Workspace: `C:\Users\StuartDargue\tms-operational-integration`. Branch: `integration/operational-baseline`. Starting tree was clean at `1261b1f`, also `origin/main`. No branch reset, merge or cherry-pick was performed. Stuart subsequently authorised a local repair commit after all final checks passed. No push or deployment is authorised.

## Exact source root cause

The modern web lineage and current operational lineage diverged at `0bf41dc`. `seo/tms-wizard` contains `14d8ac2` (SEO/public site/Contact and frame separation) followed by `481990f` (public brand/product experience). Neither commit is an ancestor of `1261b1f`. The latter descends through internal billing (`c50f5b6`, `10e61b0`), Driver PWA merge `42dfc08`, SevenDay merge `9cb0603`, then auth/permissions/Assistant/integrations changes. Security and earlier offline POD/tracking history remain shared ancestors.

Consequently, deploying `1261b1f` built the old `app/page.tsx`, old landing components and old root frame, with no feature/guide/Contact routes, public `.tms-brand` styling, SEO metadata or branded AuthSurface. A healthy build only established that this older source compiled. It did not establish that the separate modern web work was included. This is a source-composition omission. Nothing in `1261b1f` had merged and then reverted those two web commits.

Local `origin/main` reflog records `c7aaf43`, then `10e61b0`, then the push of `1261b1f`; local `main` remains at `052c85e`. Those recorded operational tips also lack the two modern web commits. This proves the ancestry and composition defect; it does not independently identify which earlier Vercel artifact Stuart had seen. No hosted deployment history was read or modified.

Inspection covered the graph, common ancestor, both commit change sets, the complete HEAD-versus-web file inventory (172 paths), all overlapping files and previous operational/main tips. The web delta from the common ancestor contains 64 paths; repository housekeeping and environment defaults were excluded as described below. The operational-only side contains billing, Driver PWA, SevenDay, auth and modernisation additions that must not be replaced by the older web tree.

## Deliberate reconciliation

Restored 55 individual public/SEO files from `481990f` only after confirming that `1261b1f` had not changed each from their shared baseline. This includes the final versions of work introduced by both web commits. Four overlapping files were reconciled manually: root layout, login, confirmation and route-classification tests.

- `app/layout.tsx` now uses `SiteFrame`, the intended metadata origin and private default robots. The synchronous theme script, root font settings, hydration handling and operational fallback colours remain intact.
- `SiteFrame` separates exact static marketing/legal surfaces from the application frame. `ApplicationFrame` carries all current responsibilities together: TenantProvider, PastDueBanner, current AppShell, ThemeScope and ContextualAssistant. Auth and customer-token pages retain their application providers. No operational route is classified as a marketing surface.
- Login and confirmation use AuthSurface while preserving every current recovery helper, legacy fragment error handling, intended destination, single-use guidance, request route and same-origin POST confirmation. Auth callback/API, magic-link helper and Supabase clients remain unchanged from `1261b1f`.
- The existing operational AppShell is retained with its mobile disclosure, current navigation, theme toggle and sign-out flow. Its visible product spelling is now TMS Wizard. Signed-in auth confirmation is explicitly excluded from console chrome, like login/signup.
- Restored homepage/workflow/product illustration, feature hub and three details, selection guide, Contact and native thank-you, modern navigation/footer/pricing, brand styles, social image, canonicals, sitemap, robots and private indexing headers. Brand CSS stays scoped to `.tms-brand`; root/global operational tokens are unchanged.
- Signup presentation and its closed state use the brand frame and current Contact path. The existing signup gate and handlers are preserved. Legal rendering restores public contact presentation and the Contact-provider notice without changing policy source documents.
- Restored the existing web branch's FormSubmit enquiry implementation and public contacts (`support@tmswizard.com`, `0800 999 1263`). No submission or provider activation was performed. The old unused landing RequestAccessForm component was removed, as in the modern branch; the existing `/api/request-access` endpoint and its backend/rate-limit code remain intact.
- Public-route/auth classification adds only the exact new marketing/social routes. Current protected Assistant, catalogue and operational entries are retained. Security response headers are preserved alongside SEO headers.
- Restored the web branch's navigation/indexing/contrast/contact tests and localhost-only HTTP/browser scripts. Script artifacts/profiles now stay under ignored `.verification/`, and checks include current protected routes and Danielle recovery presentation. No tooling packages were installed.

## Preservation and exclusions

The SEO branch did not modify `app/dashboard/page.tsx`, AppShell, navConfig, shared Button/Modal, global CSS or operational theme tokens. It would be incorrect to invent a missing dashboard/sidebar redesign. Current versions remain authoritative; only AppShell's displayed spelling changed. Dashboard, all driver/planning/API/invoices/settings files, billing/offline/planning/auth logic, Supabase clients, permissions, Assistant/integrations, driver assets, migrations and current Button/Modal are unchanged from `1261b1f` (21 verified file groups).

No Fuel Cards/Fleet Profitability (`1423f99`) or planning-regime/ADR (`98f14f5`) work was introduced. No entire web-branch tree was copied, so its older operational files did not overwrite the production baseline. No `.env` file, hosted Auth setting, database, domain or DNS was modified. `.env.example` defaults, binary `.gitignore` and generated upstream AGENTS.md were deliberately not imported; README was updated narrowly, retaining the current operational handoffs. Prior recovery/modernisation reports remain intact. Imported `docs/seo` material is historical upstream documentation; this report holds the results for the composed source.

## Verification

- Full Vitest: **258 files / 3,012 tests passed**. Includes navigation, all auth recovery/route-classification tests, planning/driver/offline/POD/billing/security, permissions, Assistant and integrations. No test assertions/timeouts were weakened.
- Initial focused integration suite: **34 files / 612 tests passed**. New composition regressions verify all console navigation destinations remain present/private/visible to resolved tenants, integrations/permissions retain their boundary, and public auth presentation includes the current recovery and POST flow.
- Full standalone `npm.cmd run typecheck`: **passed**.
- Full `npm.cmd run build -- --webpack`: **passed**, real IBM Plex font downloads, Next 16.3.5, compilation, TypeScript, route generation and **67 static pages**. Webpack is required for this checkout's existing dependency junction. The first sandbox attempt was blocked by font networking; an authorised retry compiled but exposed the absence of local public Supabase env values. The completed build used inert `https://tms-verification.invalid` / `verification-public-key` values. No production credentials or font substitution were used. This local build validates source structure and typography; its inert backend configuration must not be deployed.
- Built route-manifest check: **all 158 original page/handler routes remain**, plus restored public routes. Build homepage HTML contains `.tms-brand`, the modern workflow headline and product/Contact navigation. Baseline operational file groups are unchanged. This is evidence of the actual build composition, not only compiler success.
- Local production HTTP check: **18 public pages / 24 private-auth-token responses passed**, plus sitemap, robots, query-independent canonical and 1200×630 social image. Current dashboard/planning/driver/POD/invoices/permissions/integrations routes still redirect anonymously; Assistant/catalogue APIs return 401.
- Browser and final whitespace/status results are recorded below after completion.

Live authenticated operator/device/Safari flows and hosted enquiry delivery were not exercised. Public-browser tests block remote requests and fulfil provider responses locally; auth checks do not redeem tokens or submit login/signup. No real account, email or hosted data operation took place. No claim is made that this local repair has reached production.

## Exact restored file manifest

Individually baseline-checked files sourced from `481990f`:

```text
app/components/ApplicationFrame.tsx
app/components/SiteFrame.tsx
app/components/TenantGate.tsx
app/contact/page.tsx
app/contact/thank-you/page.tsx
app/features/electronic-proof-of-delivery/page.tsx
app/features/page.tsx
app/features/transport-invoicing/page.tsx
app/features/transport-job-management/page.tsx
app/guides/choosing-transport-management-software/page.tsx
app/legal/page.tsx
app/page.tsx
app/robots.ts
app/signup/SignupForm.tsx
app/signup/page.tsx
app/sitemap.ts
app/social-preview/route.tsx
components/contact/EnquiryForm.tsx
components/landing/AuthSurface.tsx
components/landing/Brand.tsx
components/landing/ContactSection.tsx
components/landing/FeatureGrid.tsx
components/landing/FeaturePage.tsx
components/landing/Footer.tsx
components/landing/Hero.tsx
components/landing/HomeQuestions.tsx
components/landing/LandingNav.tsx
components/landing/MarketingShell.tsx
components/landing/OperationalConfidence.tsx
components/landing/PricingCard.tsx
components/landing/ProductBoard.tsx
components/landing/WorkflowStory.tsx
components/landing/brand.css
components/legal/LegalPage.tsx
components/legal/LegalShell.tsx
docs/seo/audit.md
docs/seo/brand-upgrade.md
docs/seo/contact.md
docs/seo/validation.md
lib/auth/publicRoutes.ts
lib/contact/details.ts
lib/contact/enquiry.test.ts
lib/contact/enquiry.ts
lib/legal/metadata.test.ts
lib/legal/metadata.ts
lib/nav/shouldShowShell.ts
lib/seo/brandContrast.test.ts
lib/seo/content.ts
lib/seo/indexing.test.ts
lib/seo/indexing.ts
lib/seo/routes.ts
lib/seo/site.ts
next.config.ts
scripts/seo/check-browser.mjs
scripts/seo/check-http.mjs
```

Manually reconciled overlaps:

```text
app/auth/confirm/page.tsx
app/layout.tsx
app/login/page.tsx
lib/auth/routeClassification.test.ts
```

## Final browser review and precommit Git state

Local headless Edge: **132 page/viewport checks passed** (22 public/auth/utility pages at 320, 375, 768, 820, 1024 and 1440 px), including one-H1/canonical/indexing checks, normal-text contrast, no horizontal overflow, public navigation Escape/focus return and skip link. Contact validation, activation-required, malformed-response, rate-limit, duplicate prevention, honeypot and native fallback passed with four intercepted provider requests and zero real enquiries. Additional login consumed/expired-link and PKCE guidance checks and an inert invitation confirmation GET passed without redemption. No browser exceptions, console errors, remote requests or application-data requests were observed. Enabled-signup form layouts were not exercised in this run; its handler/gate tests passed. Desktop/mobile homepage and desktop branded login screenshots were visually inspected using real IBM Plex fonts.

`git diff --check`: **passed** using the repository's existing line-ending settings. A separate diagnostic with `core.autocrlf=false` falsely treated existing CRLFs as trailing whitespace; no file/line-ending rewrite was needed.

At the precommit review, HEAD remained `1261b1f` on `integration/operational-baseline`. Precommit status: **24 modified tracked files, 1 deleted obsolete component, 40 new files; 0 staged files**. At that review, nothing had been committed, pushed or deployed. All changes were reviewable in this workspace; verification artifacts are ignored under `.verification/`. The resulting source and tested build contain both the modern public TMS Wizard experience and the current operational implementation. Stuart subsequently authorised staging and a local commit with the exact repair message after all checks passed; push and deployment remain unauthorised.

Exact final status:

```text
 M README.md
 M app/auth/confirm/page.tsx
 M app/components/AppShell.tsx
 M app/components/TenantGate.tsx
 M app/layout.tsx
 M app/legal/page.tsx
 M app/login/page.tsx
 M app/page.tsx
 M app/signup/SignupForm.tsx
 M app/signup/page.tsx
 M components/landing/FeatureGrid.tsx
 M components/landing/Footer.tsx
 M components/landing/Hero.tsx
 M components/landing/LandingNav.tsx
 M components/landing/PricingCard.tsx
 D components/landing/RequestAccessForm.tsx
 M components/legal/LegalPage.tsx
 M components/legal/LegalShell.tsx
 M lib/auth/publicRoutes.ts
 M lib/auth/routeClassification.test.ts
 M lib/legal/metadata.test.ts
 M lib/legal/metadata.ts
 M lib/nav/shouldShowShell.test.ts
 M lib/nav/shouldShowShell.ts
 M next.config.ts
?? app/components/ApplicationFrame.tsx
?? app/components/SiteFrame.tsx
?? app/contact/page.tsx
?? app/contact/thank-you/page.tsx
?? app/features/electronic-proof-of-delivery/page.tsx
?? app/features/page.tsx
?? app/features/transport-invoicing/page.tsx
?? app/features/transport-job-management/page.tsx
?? app/guides/choosing-transport-management-software/page.tsx
?? app/robots.ts
?? app/sitemap.ts
?? app/social-preview/route.tsx
?? components/contact/EnquiryForm.tsx
?? components/landing/AuthSurface.tsx
?? components/landing/Brand.tsx
?? components/landing/ContactSection.tsx
?? components/landing/FeaturePage.tsx
?? components/landing/HomeQuestions.tsx
?? components/landing/MarketingShell.tsx
?? components/landing/OperationalConfidence.tsx
?? components/landing/ProductBoard.tsx
?? components/landing/WorkflowStory.tsx
?? components/landing/brand.css
?? docs/reviews/2026-10-11-production-ui-recovery.md
?? docs/seo/audit.md
?? docs/seo/brand-upgrade.md
?? docs/seo/contact.md
?? docs/seo/validation.md
?? lib/contact/details.ts
?? lib/contact/enquiry.test.ts
?? lib/contact/enquiry.ts
?? lib/seo/brandContrast.test.ts
?? lib/seo/composition.test.ts
?? lib/seo/content.ts
?? lib/seo/indexing.test.ts
?? lib/seo/indexing.ts
?? lib/seo/routes.ts
?? lib/seo/site.ts
?? scripts/seo/check-browser.mjs
?? scripts/seo/check-http.mjs
```
