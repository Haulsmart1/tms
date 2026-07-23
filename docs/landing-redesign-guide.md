# Landing redesign: what changed and how it works

Branch `feat/landing-redesign`, 18 commits, 31 files. **Not merged.**

This guide explains the change in the order you would need to understand it: the
one big idea first, then the pieces, then what is still outstanding.

---

## 1. The one thing to understand first

The app has roughly 15 existing pages (`/dashboard`, `/jobs`, `/invoices`, and so
on) styled entirely with **inline styles** and no Tailwind. The new landing page
is built with Tailwind and a design system. Those two things do not naturally
coexist, because Tailwind ships a global CSS reset called **Preflight** that
would restyle every heading, table, list and button on all 15 legacy pages.

So the whole design system is **opt-in**, and that shapes everything else:

```
tailwind.config.ts   corePlugins: { preflight: false }   <- no global reset at all
app/globals.css      @layer base { .ds ... }             <- the reset, scoped to a class
app/page.tsx         <div className="ds font-sans ...">  <- the landing opts IN
app/login/page.tsx   <div className="ds font-sans ...">  <- /login opts IN
                     (legacy pages carry neither, so nothing changes for them)
```

**Two classes are load-bearing on any new design-system page:**

| Class | What it does | If you forget it |
|---|---|---|
| `ds` | Opts into the scoped reset: `border-style`, `box-sizing`, control font inheritance | Borders vanish entirely, containers overflow into horizontal scroll |
| `font-sans` | Applies IBM Plex | You silently get Inter |

Neither failure throws an error. That is why both `app/layout.tsx` and
`app/globals.css` carry long "read before editing" comments.

### Why the reset uses `:where()`

Inside `app/globals.css` you will see selectors like:

```css
:where(.ds) :where(h1, h2, h3, h4, p, figure, ul, ol) { margin: 0; }
```

`:where()` contributes **zero specificity**. This matters enormously. Tailwind's
real Preflight uses bare element selectors like `h1`, which score (0,0,1) and sit
*below* every utility class. If you write `.ds h1` instead, it scores (0,1,1),
which *beats* utilities at (0,1,0), and the reset starts overriding the very
utilities it exists to support. We hit exactly that: `mt-4` stopped working on
every heading, and `color: inherit` beat `text-white` on the primary button,
dropping it to **1.9:1 contrast**, a hard accessibility failure on the main call
to action. `:where()` restores the correct order.

### Why `safelist: ["ds"]` exists

Tailwind tree-shakes `@layer base` rules against its content scan. With no page
yet carrying `class="ds"`, it stripped the entire reset from the compiled CSS.
Safelisting guarantees it is always emitted, including if the class is ever
composed at runtime where the scanner cannot see it. **Do not delete it** just
because pages now use `ds`.

---

## 2. What each new file does

### Foundation

| File | Purpose |
|---|---|
| `tailwind.config.ts` | Maps Tailwind class names onto the CSS variables. Pinned to Tailwind **3.4**, see below |
| `app/tokens.css` | The design tokens as CSS variables, plus the dark scaffold and the global focus ring |
| `app/globals.css` | Imports tokens, pulls in Tailwind, and defines the `.ds` scoped reset |
| `postcss.config.js` | Tailwind + autoprefixer |
| `app/layout.tsx` | Loads globals, declares the Plex font variables on `<html>` |

**Tailwind is pinned to `^3.4` deliberately.** A bare `npm i tailwindcss` now
installs v4, which uses a different PostCSS plugin, drops autoprefixer, and
replaces the `@tailwind` directives with `@import "tailwindcss"`. Our v3-style
config would not compile against it.

**`@import "./tokens.css"` must be the first line of `globals.css`.** CSS requires
`@import` to precede all other rules, so a late import is silently discarded by
postcss-import, which would strip every design token from the build. (The handoff
README says to import after the `@tailwind` directives. That instruction is
wrong.)

### Primitives (`components/`)

| Component | Notes |
|---|---|
| `Button` | Variants primary/secondary/ghost/danger, sizes sm/md/lg. Defaults `type="button"` |
| `buttonClasses()` | Exported from `Button.tsx`. For links that should *look* like buttons |
| `Badge` | Tinted status pill, used in the hero product mock |
| `Field` | Labelled input, wired for accessibility |
| `Textarea` | Multi-line sibling of `Field` |
| `Container` | Shared max-width and page gutter |
| `lib/cn.ts` | Joins class names |

Three decisions here are worth knowing, because each fixes a real defect:

**`buttonClasses()` instead of nesting.** Writing
`<a href="..."><Button>Go</Button></a>` puts a real `<button>` inside an `<a>`,
which is invalid HTML and creates a confusing double stop for screen readers.
Links that look like buttons do `<a className={buttonClasses("primary", "lg")}>`
instead.

**`Button` does not disable itself while loading.** Disabling the focused button
mid-submit drops keyboard focus to `<body>`, so a keyboard or screen reader user
loses their place. It stays focusable and sets `aria-busy` instead, which is why
forms guard double submission themselves with `if (loading) return`.

**`cn()` composes, it does not override.** Tailwind resolves equal-specificity
utilities by *stylesheet order*, not by the order classes appear in the attribute.
So `<Container className="max-w-3xl">` does **not** override a base of
`max-w-6xl`; it is silently ignored. If a component needs a genuine override, give
it an explicit prop.

### The landing page (`components/landing/`)

`app/page.tsx` composes six sections in order: `LandingNav`, `Hero`,
`FeatureGrid`, `PricingCard`, `RequestAccessForm`, `Footer`.

It is a **server component**, so the marketing copy ships as static HTML for SEO.
Only `LandingNav` (mobile menu state) and `RequestAccessForm` (submission state)
are client components.

The hero shows a **jobs table mock rather than a photograph**. The design system
forbids photography behind text, and an operator evaluating transport software
wants to see the tool before filling in a form.

### Sign-in moved to `/login`

The landing no longer carries a sign-in form, so `/login` now owns it. That forced
a third change: `app/api/auth/callback/route.ts` previously sent failures to `/`,
which would now be a dead end. Failures go to `/login?error=...`, and `/login`
reads that parameter and offers to send a fresh link.

The magic-link flow itself is **unchanged**. Same `signInWithOtp`, same callback,
same session handling.

### The request-access endpoint

```
RequestAccessForm -> POST /api/request-access -> Zod validation
                  -> INSERT registration_requests (service role)   [system of record]
                  -> Resend email                                  [best effort]
                  -> /super-admin/requests                         [where leads are read]
```

**The database is the system of record, not the email.** Earlier this emailed and
nothing else, so a Resend failure lost the lead permanently and nobody knew
anyone had tried. Now the row is stored first and the notification is attempted
afterwards, allowed to fail without failing the request. The response carries
`notified: true|false` so a stored-but-unnotified lead is distinguishable.

**Writes use the SERVICE ROLE key, not anon.** The anon key is public, it ships in
the client bundle, so granting anon INSERT would let anyone POST straight to
PostgREST and bypass the honeypot and rate limit. Routing writes through the
service role makes the guarded route the only way in. This was not theoretical:
during setup an anon insert genuinely returned `201` until a leftover INSERT
policy was dropped. See `lib/supabase/admin.ts` and
`docs/sql/registration_requests_rls.sql`.

**Reading leads** happens at `/super-admin/requests`, which reads with the ordinary
session client so RLS does the real work. The layout's role guard is the first
layer and the RLS policy is the second.

- `lib/validation/requestAccess.ts` is the Zod schema, covered by 7 Vitest tests.
- The route returns **field-keyed 400s**, so the form renders each message under
  its own input.
- Missing config returns a deliberately vague 500 to the client and a specific
  message to the server log. The response is public and should not disclose which
  piece of configuration is absent.

**Abuse protection**, because this is a public endpoint that sends an email on
every valid POST:

1. **Honeypot**: a hidden `companyWebsite` field. If it arrives non-empty, the
   route returns `200` *without* sending, so a bot cannot tell it was rejected and
   retry with the field removed.
2. **Rate limit**: 5 requests per IP per minute. **Know its limit**: it is held in
   memory, so it is per server instance and resets on redeploy. On serverless that
   makes it a speed bump against trivial loops, not a real limiter. If abuse
   materialises, move to Redis or put Turnstile in front of the form.

---

## 3. Accessibility decisions

The design system claims WCAG 2.1 AA, so these were measured, not assumed.

- **Input borders use `ink-3`, not `line-strong`.** The handoff specified
  `line-strong` (#CBD5E1) for input borders, which measures **1.48:1** on white
  and fails WCAG 1.4.11 (needs 3:1). The border is the only thing identifying an
  empty input, and on the form's `surface-2` card the fill differentiation is
  1.045:1. `ink-3` measures 4.76:1. Same reasoning for placeholder text.
- **One live region per form.** Per-field errors are plain text referenced by
  `aria-describedby`. If each field had `role="alert"`, six failing fields would
  mount six assertive regions that interrupt each other and the user would hear
  only the last. The form owns a single `role="alert"` summary.
- **The focus ring is global on purpose.** The `:focus-visible` rule in
  `tokens.css` is the one rule that deliberately reaches the legacy pages. That is
  an accessibility improvement, and the handoff says never to remove outlines
  without a replacement.
- **Touch targets**: the nav CTA is 40px and the mobile menu button is 44px.

---

## 4. Running and verifying it

```bash
npm run dev         # http://localhost:3000
npm run build       # production build, expect 31 routes
npm run typecheck   # next typegen && tsc --noEmit
npm test            # vitest, 7 tests
```

`next-env.d.ts` is no longer tracked in git: Next rewrites it on every build and
dev start, which produced meaningless diffs. `npm run typecheck` regenerates it,
which is why it runs `next typegen` first.

**Verified at the time of writing**: tests 7/7, typecheck clean, build clean at 31
routes; `/` renders with the `ds` wrapper and the corrected JSON-LD price; `/login`
returns 200; an empty callback redirects to `/login?error=missing_code`;
`/dashboard`, `/jobs` and `/invoices` still serve their original inline styles and
carry no `ds` class; the honeypot returns a silent 200 and the 6th request in a
minute returns 429.

---

## 5. Outstanding before this can go live

**In this order. The first two break lead capture hardest, and both fail quietly.**

1. **Set `SUPABASE_SERVICE_ROLE_KEY`** in the deployment environment (Vercel project
   settings). Without it, every submission returns a 500 and no lead is stored at
   all. Server-only, no `NEXT_PUBLIC_` prefix. See `.env.example`.
2. **Run `docs/sql/registration_requests_rls.sql`** in the Supabase SQL editor, then
   run the verification queries at the bottom of that file. Without it, either
   anyone with the public anon key can write to the table, or super admins cannot
   read it. The requests page detects the second case and says so explicitly rather
   than showing a misleading "No requests yet".
3. **Resend needs a verified sending domain.** Add the DNS records Resend provides
   for `adrcarriers.net` and set `MAIL_FROM` to an address on that domain, plus
   `RESEND_API_KEY` and `LEAD_INBOX`. Until this is done, **leads are stored but
   nobody is notified**: the route returns `notified: false` and logs
   "LEAD STORED BUT NOBODY NOTIFIED", and the only place they surface is
   `/super-admin/requests`. The visitor is told their request was received, which
   is true, so the risk is that real leads sit unread. Either finish this before
   launch or make someone responsible for checking that page daily.
4. **Look at it.** Everything above is measured, but nobody has yet judged whether
   it looks right. Run `npm run dev` and open `/` at desktop and mobile widths.

### Known follow-ups, none blocking

- The dark scaffold in `tokens.css` overrides 27 of 37 tokens. `--focus` is the
  notable gap at 2.84:1 on the dark surface, and that ring is global. Fix before
  enabling dark mode.
- The numeric `primary` 50-950 ramp in the config is literal hex and is **not**
  themed, so it will not follow a dark-mode variable swap. Nothing uses it.
- Token colours cannot take opacity modifiers. `bg-primary/10` compiles to nothing,
  silently. Use a `*-tint` token instead.
- Two things worth raising with whoever wrote the handoff: the `@import` ordering
  instruction is wrong, and `line-strong` for input borders fails the AA target the
  handoff itself claims.
