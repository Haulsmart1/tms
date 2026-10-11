> Historical SEO-branch handoff, restored from `481990f`. Current composed-source results and actual font-enabled build verification are in [the production UI recovery report](../reviews/2026-10-11-production-ui-recovery.md).

# SEO and public brand validation handoff

Worktree: `C:\Users\StuartDargue\tms-seo-development`. Branch: `seo/tms-wizard`. The completed SEO/Contact baseline is commit `14d8ac2`. The current public brand upgrade is based on that commit; its changes remain intact for local or external commit.

See [brand audit, design direction and application evidence](brand-upgrade.md), [original SEO audit](audit.md) and [unchanged Contact delivery/activation notes](contact.md).

## Final brand-phase results

| Check | Result |
| --- | --- |
| Full Vitest suite | PASS: 240 files, 2,914 tests; includes 17 new brand contrast regressions |
| Typecheck | PASS: standalone `next typegen && tsc --noEmit` and final build TypeScript stage |
| Standard production build | BLOCKED only by existing IBM Plex Google font downloads in this restricted environment |
| Production build with local test-only font fixture | PASS: Next 16.4.0, compilation, TypeScript and all 66 static pages generated |
| Production HTTP checks | PASS: all 18 public pages, official contacts, 15 private/auth/token headers, redirects, sitemap, robots, query canonical and 1200x630 social image |
| Production Edge browser checks | PASS: 132 layouts covering all 22 public/auth/utility pages at 320, 375, 768, 820, 1024 and 1440 px; includes normal-text contrast, one H1, indexing/canonicals, contact links and overflow |
| Enabled signup presentation | PASS: six additional widths on a second disposable local server with SIGNUP_ENABLED=true; fields inspected without submission |
| Navigation and enquiry flow | Mobile menu opens and closes with Escape/focus return; skip link visible on focus. Provider responses intercepted locally: validation, activation-required, malformed JSON, rate limit, success, duplicate prevention and honeypot suppression. Native action/validation preserved |
| Manual visual review | Mobile homepage, Contact, POD, enabled signup; desktop homepage, feature hub, guide, Contact, login and legal index; homepage story/features/pricing/CTA sections and social preview |
| Browser/network isolation | No real enquiry, signup request, authentication email or customer operation. No remote assets or application data requests on the tested anonymous pages |
| Diff review | Existing canonical/robots/sitemap/index-control/auth allowlist and FormSubmit implementation files are unchanged. No application, Driver PWA, SevenDay or Load Transfer implementation edits |
| Whitespace | `git diff --check` passed; existing CRLF advisories only |

The ordinary source still uses IBM Plex through `next/font/google`. The ignored `.seo-test/font-responses.cjs` substitutes installed system fonts only for local validation. It is not a product font change, must not be used for deployment, and does not establish production typography or field Core Web Vitals. No new dependencies or third-party artwork were introduced. Marketing visuals are server-rendered HTML/CSS/owned SVG.

Public/auth utilities retain noindex metadata/headers and have no inherited canonical. Private operational routes retain anonymous login redirects. Token/PDF handlers without backend credentials can return errors; checks establish noindex on those responses, not real customer-link functionality. No authenticated operational smoke test was performed. Existing auth and signup unit tests passed; presentation changes do not replace a real account-flow check during a separately authorised release.

Official contact details remain **support@tmswizard.com** and **0800 999 1263**. FormSubmit mailbox activation and live delivery remain unverified: every test provider request was intercepted before transmission. The current form, recipient, native fallback, validation, honeypot, timeout and success/error handling are unchanged. Legal source PDFs/JSON and official-email rendering remain unchanged.

## Repeat validation safely

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Use normal font-download access for the standard build. For the restricted local fixture only, build with NEXT_FONT_GOOGLE_MOCKED_RESPONSES pointing to the ignored local fixture, NEXT_PUBLIC_SUPABASE_URL=https://seo-test.invalid and NEXT_PUBLIC_SUPABASE_ANON_KEY=seo-test-placeholder. There is no .env.local in this validation checkout and no service-role key. Never use production credentials for these scripts.

Start the production build locally, then run the scripts in another shell in the same worktree:

```powershell
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3107
node scripts/seo/check-http.mjs
node scripts/seo/check-browser.mjs
```

To include the enabled-signup presentation, start a separate disposable server in another shell:

```powershell
$env:SIGNUP_ENABLED = 'true'
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108
```

Then set SEO_SIGNUP_TEST_ORIGIN=http://127.0.0.1:3108 for the browser script. This does not enable signup on the primary server or any deployment. The script inspects the form without sending it.

Scripts reject non-localhost targets. Browser tooling uses installed Edge/Chromium, Node WebSocket and a worktree-local profile without package installation. The browser blocks remote page requests and fulfils FormSubmit test requests locally before transmission. It uses --no-sandbox for this restricted Windows account; do not use it to browse untrusted pages.

## Local artifacts

Ignored artifacts include `.seo-artifacts/http-results.json`, `browser-results.json`, mobile homepage/Contact/POD screenshots, `brand-*-1440.png` desktop screenshots, homepage section screenshots, `brand-signup-enabled-375.png` and `brand-social-preview.png`. All test profiles, fixtures and build output remain outside the commit manifest.

## Release checks still required

- Actual IBM Plex rendering and layout after a normal font-enabled production build.
- Physical-device Safari/VoiceOver and Android/TalkBack, high zoom and complete keyboard use. Automated contrast checks are evidence, not a WCAG certification.
- FormSubmit activation and live email delivery, separately authorised; no real enquiry was sent here.
- Real authenticated sign-in/signup and operator workflows with safe test accounts, separately authorised.
- Production primary-host redirects for tmswizard.cloud versus historical tmswizzard.cloud references, Search Console coverage, social-card cache refresh and field LCP/INP/CLS.
- No push, deployment, SQL execution, production-data mutation or other-worktree edit occurred.

## Commit status and exact manifest

Final browser results: 132 public/auth/utility layouts plus six enabled-signup layouts passed, with zero contrast failures, exceptions, console errors, remote requests or application data requests. Four FormSubmit POSTs were fulfilled locally; zero real enquiries. Commit status is recorded below. Suggested commit title: `feat(web): upgrade TMS Wizard public brand and product experience`.

All paths in the manifest are relative to the SEO worktree. Stage only these brand-phase changes; the earlier SEO phase is already committed as 14d8ac2.

Exact brand-phase manifest (34 files):
```text
app/auth/confirm/page.tsx
app/contact/page.tsx
app/contact/thank-you/page.tsx
app/features/page.tsx
app/guides/choosing-transport-management-software/page.tsx
app/legal/page.tsx
app/login/page.tsx
app/page.tsx
app/signup/page.tsx
app/signup/SignupForm.tsx
app/social-preview/route.tsx
components/landing/AuthSurface.tsx
components/landing/brand.css
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
components/legal/LegalShell.tsx
docs/seo/audit.md
docs/seo/brand-upgrade.md
docs/seo/validation.md
lib/seo/brandContrast.test.ts
README.md
scripts/seo/check-browser.mjs
scripts/seo/check-http.mjs
```

Git staging was attempted after validation and failed: permission denied creating C:/Users/StuartDargue/tms-production-current/.git/worktrees/tms-seo-development/index.lock. No new commit was created; HEAD remains 14d8ac2. All 34 brand-phase files above remain intact and unstaged for external commit. No push or deployment was attempted.
