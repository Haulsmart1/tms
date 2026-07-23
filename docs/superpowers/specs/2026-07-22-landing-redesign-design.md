# TMS Wizzard: Design-System Foundation + Landing Redesign

**Date:** 2026-07-22
**Status:** Draft for review (revised after adversarial review)
**Author:** Ethan (with Claude, brainstorming session)

---

## 0. Where this fits

"Full self-serve signup" decomposes into six sub-projects. This spec covers **only the first**. It is front-end plus one thin email route. It does **not** touch the multi-tenant data model, auth provisioning, or billing backend:

| # | Sub-project | Lane | This spec? |
|---|-------------|------|------------|
| 1 | Design-system foundation | Front-end | Yes |
| 2 | Landing page redesign | Front-end | Yes |
| 3 | Signup UI flow | Front-end (needs 4) | Later |
| 4 | Provisioning backend | Backend (boss's data model) | Later |
| 5 | Billing lifecycle (Square webhooks) | Backend (boss) | Later |
| 6 | Tenancy + security cleanup | Backend (boss) | Later |

Pieces 4 to 6 change the Supabase data model and sit on top of known security holes (`FALLBACK_TENANT_ID`, `tenant_id` vs `company_id` inconsistency). They need the boss's sign-off and are out of scope here.

## 1. Goal

Replace the current dark, inline-styled landing page with a modern, trustworthy, **product-forward** landing built on the TMS Wizzard design system, to increase onboarding. Because the self-serve signup backend does not exist yet, the page uses a **polished lead-capture** model: it presents the product and pricing, and drives visitors to a "Request access" form and existing-customer sign-in. The primary CTA is structured so it can later swap to real self-serve signup.

## 2. Decisions locked (this session)

- **Onboarding model:** polished lead-capture (not live self-serve yet).
- **Landing structure:** product-forward. The hero shows the real product beside a tight headline and dual CTA.
- **Sign-in:** dedicated `/login` page (magic-link flow unchanged, re-skinned).
- **Request-access submission:** Next.js API route with Zod validation, emailing via Resend (already a dependency). No third-party form host.
- **Pricing:** confirmed at **£10 per vehicle per month**.
- **Tailwind version:** pin **v3.4.x** so the handoff config works verbatim (see section 4 for why, and the v4 alternative).
- **Global reset:** Tailwind **Preflight disabled**, font and canvas scoped to the landing, so no other route changes.
- **Design language:** the handoff system verbatim. Light `--canvas`, one haulage-blue primary for all actions, slate neutrals, borders for structure (shadows only for overlays), IBM Plex Sans/Mono, 14px base, no photography behind text, lucide icons (never emoji), WCAG 2.1 AA.

## 3. Scope

**In scope**
- Install and wire the design system (Tailwind v3.4 + tokens + fonts + base components).
- Rebuild `/` (landing) in the new system.
- Add `/login` in the new system (re-skin of the existing magic-link sign-in).
- Add a Next API route + Resend for the request-access form.
- Repoint the auth callback's error redirects to `/login` (small, required by the sign-in move).

**Out of scope (unchanged this spec)**
- Every other app page (`/dashboard`, `/jobs`, `/invoices`, and the rest). Because Preflight is disabled and the font/canvas are scoped, these stay pixel-identical.
- Real self-serve signup, account/company provisioning, Square checkout, webhooks.
- Tenancy and security cleanup.

## 4. Design-system foundation

### 4.0 Prerequisite: get the handoff files into the repo
The handoff `tokens.css` and `tailwind.config.ts` (pasted this session; token values are in `TMSWizzard.pdf` p.5, contrast pairs on p.2) do **not** exist in the repo yet. **Step one is committing them in** as `app/tokens.css` and `tailwind.config.ts`. Everything below depends on that.

### 4.1 Tailwind version (pin v3.4)
A bare `npm i tailwindcss` in 2026 installs **v4**, which is incompatible with the handoff config: v4 uses `@tailwindcss/postcss` (not the `tailwindcss` PostCSS plugin), drops `autoprefixer`, wants `@import "tailwindcss";` instead of the three `@tailwind` directives, and does not auto-load a JS/TS config without an `@config` directive. Next 16 builds with Turbopack, which consumes the PostCSS plugin, so the mismatch fails the build immediately.
**Decision:** pin `tailwindcss@^3.4`, `postcss`, `autoprefixer`. This keeps the handoff's v3-style `tailwind.config.ts`, `@tailwind` directives, and `autoprefixer` all valid. (A v4 migration is a possible later task, but it means rewriting the config to CSS-first `@theme`, so not now.)

### 4.2 Keep the reset off the rest of the app
Importing `globals.css` (which includes `@tailwind base`, i.e. Preflight) into the root layout would apply a global reset to all ~15 other routes, which currently rely on browser defaults plus inline styles. That would shift their headings, lists, tables, and buttons.
**Decision:** set `corePlugins: { preflight: false }` in `tailwind.config.ts`. The landing gets its own scoped resets (box-sizing, margins) on its wrapper. Utilities still work everywhere they are used, but no global reset lands on the other pages. When the app-wide restyle happens (a later spec), re-enable Preflight and run a full-route regression.

### 4.3 Files
- `app/tokens.css`: from the handoff (`:root` light theme, `.dark` scaffold, global `:focus-visible` ring).
- `tailwind.config.ts`: from the handoff, with `corePlugins.preflight = false` added; `content` globs cover `app/**` and `components/**`.
- `postcss.config.js`: `tailwindcss` + `autoprefixer` (valid because we pinned v3).
- `app/globals.css`: `@tailwind base/components/utilities;` then `@import "./tokens.css";` **after** the directives.
- `app/layout.tsx`: import `globals.css`; load IBM Plex Sans + Mono via `next/font/google`, exposing `--font-sans` and `--font-mono` **as CSS variables on `<html>` without applying them to `<body>`**. **Do not change the body background or default font here** (that would hit other routes). The landing and `/login` opt into `font-sans` and `bg-canvas` on their own top-level wrapper.

### 4.4 Existing header
`AppHeader` already returns `null` on `/` and `/super-admin`, so the landing supplies its own nav with no conflict. `AppHeader` is not restyled in this spec.

## 5. Landing composition (`/`)

Top-to-bottom, on a landing-scoped light `--canvas` wrapper:

1. **LandingNav** (sticky, ~56px): wordmark left; `Features`, `Pricing`, `Contact` anchors; `Sign in` (ghost, links to `/login`); `Get started` (primary, targets the request-access section for now). Light `--surface` with a hairline bottom border.
2. **Hero**: two columns. Left: overline chip ("ALL-IN-ONE CLOUD TMS"), headline ("Run your whole transport operation in one place."), sub-copy, dual CTA (`Get started` primary and `Sign in` secondary), trust line. Right: a **product screenshot mock**, a jobs table with overline headers, status badges (In transit / Delivered / Awaiting POD), and a right-aligned tabular-numeral money column. This is product UI, not a photo behind text.
3. **FeatureGrid**: 8 module cards (Jobs, POD, Transport Invoicing, Fleet, Drivers, Subcontractors, Live Tracking, Compliance & Tacho), each a lucide icon + title + one line. 4-up on desktop.
4. **Pricing**: a single pricing card showing **£10 per vehicle per month**, every module included, no setup fee. CTA "Request access".
5. **RequestAccessForm**: fields are Company name, Contact name, Email, Phone (optional), Vehicles (number), Notes (optional). Submits to the API route (section 7). Includes an "Already a customer? Sign in" link.
6. **Footer**: wordmark, short blurb, Privacy / Terms / Contact links.

**SEO / structured data:** keep a JSON-LD `SoftwareApplication` script, but **update the offer** to the real price (`price: "10"`, `priceCurrency: "GBP"`, and a unit note), or drop the price field. The current script hardcodes `price: "0"` ([app/page.tsx](../../../app/page.tsx)), which would advertise the product as free and contradict the pricing card. Keep the keyword-relevant copy in real headings and paragraphs.

## 6. Sign-in (`/login`) and callback

New route `app/login/page.tsx`. Re-skins the current magic-link (OTP) sign-in into the design system: a centered `--surface` card with a `Field` email input and a primary `Button`. Behaviour is unchanged: `supabase.auth.signInWithOtp` with `emailRedirectTo` pointing at `/api/auth/callback?next=/dashboard`.

**Callback change (required):** [app/api/auth/callback/route.ts](../../../app/api/auth/callback/route.ts) currently redirects failures to `/?error=auth` and `/?error=missing_code`. Since the sign-in form is moving off `/`, those must repoint to **`/login?error=...`**, and `/login` renders the "that link expired, request a fresh one" message and the email field. Without this, an expired-link user lands on `/` with no way to recover. The landing's inline sign-in card is removed.

## 7. Request-access lead capture

- **Client:** `RequestAccessForm` posts JSON to `POST /api/request-access`.
- **Route:** `app/api/request-access/route.ts` validates the body with a Zod schema (reuse the existing pattern at **`lib/supabase/validation/`**, e.g. `job.ts`, Zod v4). On success it sends an email via Resend and returns `{ ok: true }`.
- **Resend setup (real prerequisite):** Resend is a dependency but is used nowhere yet. A working send needs (a) a **verified sending domain** in Resend with DNS records, and (b) a `from` address. Env vars: `RESEND_API_KEY`, `MAIL_FROM` (the verified sender, e.g. `hello@adrcarriers.net`), `LEAD_INBOX` (the recipient, currently `stuart@adrcarriers.net`). For local dev, `onboarding@resend.dev` can stand in as `MAIL_FROM`. Document the DNS verification step in the runbook. Until the domain is verified, live sends will 500, so treat domain verification as a task, not an afterthought.
- **Error handling:** 400 with field errors on validation failure (surfaced inline via `Field` `role="alert"`); 500 on send failure with a friendly retry message; the client disables the button and shows a spinner while in flight; on success the form is swapped for a confirmation panel.

## 8. Components

Small, single-purpose, reusable. The primitives are the seeds of the app-wide system used in later specs. **Location: top-level `components/`** (matches the handoff's `content` glob and keeps primitives reusable app-wide).

| Component | Responsibility |
|-----------|----------------|
| `Button` | primary / secondary / ghost; sm/md/lg; loading + disabled |
| `Field` | labelled input (label `for`, `aria-describedby` hint, `role="alert"` error) |
| `Badge` | tinted status pill (used in the hero product mock) |
| `Container` / `Section` | max-width + page gutter (16px mobile, 32px desktop) |
| `LandingNav` | sticky top nav + mobile disclosure |
| `Hero` | headline + CTAs + product mock |
| `FeatureGrid` | module cards |
| `PricingCard` | pricing display |
| `RequestAccessForm` | the lead-capture form + submission state |
| `Footer` | site footer |

## 9. Responsive

- Hero: two columns collapse to a stacked single column below ~820px (product mock under the copy).
- FeatureGrid: 4, then 2, then 1 column.
- **Nav (decided):** on mobile the sticky bar keeps the wordmark and the `Get started` primary CTA always visible; `Features`, `Pricing`, `Contact`, and `Sign in` collapse behind a single disclosure toggle (a lucide menu icon button, `aria-expanded`, `aria-controls`). Nav height budget ~56px so it does not eat the small viewport.
- Primary actions use `Button` size `lg` (at least 44px touch target) on mobile; the form is full-width.

## 10. Accessibility (WCAG 2.1 AA)

- Token colour pairs are documented at 4.5:1 or better (3:1 or better for large/UI) in the handoff contrast table (`TMSWizzard.pdf` p.2); the build inherits those exact pairs.
- Semantic landmarks: `header`, `main`, `footer`; one `h1` (the hero headline); logical heading order.
- Every form control wrapped by `Field` with a real `<label for>`; errors via `role="alert"`; hints via `aria-describedby`.
- Global `:focus-visible` ring from tokens, never removed.
- Icons are lucide (decorative ones `aria-hidden`), never emoji. The product mock has a descriptive `alt`/`aria-label`. The mobile nav toggle is a real button with `aria-expanded`.

## 11. Out of scope / future seams

- The `Get started` primary CTA currently targets the request-access section. When sub-project 3/4 lands, it re-points to `/signup`, a one-line change by design.
- The pricing card structure accepts a change to tiered pricing later without a rebuild.
- Design-system primitives (`Button`, `Field`, `Badge`) are written to be reused when the rest of the app is restyled (at which point Preflight is re-enabled with a full regression pass).

## 12. Verification / acceptance criteria

- `npm run build` succeeds and `tsc --noEmit` is clean.
- `/` renders in the new light system on desktop and mobile widths with no horizontal scroll.
- `/login` sends a magic link and completes sign-in through the callback; an **expired/invalid link lands on `/login`** with the retry message (verifies the callback change).
- Request-access form: a valid submit delivers an email to `LEAD_INBOX` from `MAIL_FROM` and shows confirmation; an invalid submit shows inline field errors; a send failure shows a retry message.
- **Regression:** because Preflight is off and font/canvas are scoped, spot-check that `/dashboard`, a tenant page (e.g. `/jobs`), and a super-admin page look unchanged from before.
- Basic axe/Lighthouse a11y pass on `/` and `/login` (no contrast or label violations).
- JSON-LD offer reflects £10 (or omits price), not `0`.

## 13. Files touched / created

**Created:** `postcss.config.js`, `app/globals.css`, `app/tokens.css` (from handoff), `tailwind.config.ts` (from handoff, Preflight off), `app/login/page.tsx`, `app/api/request-access/route.ts`, `components/*` (primitives + landing pieces).
**Modified:** `app/layout.tsx` (globals import, font variables on `<html>` only), `app/page.tsx` (full rebuild + JSON-LD price fix), `app/api/auth/callback/route.ts` (error redirects to `/login`), `package.json` (deps), `.env` docs (`RESEND_API_KEY`, `MAIL_FROM`, `LEAD_INBOX`).
**Unchanged:** all other routes, `AppHeader`, Supabase client/session logic, Square subscription work.
