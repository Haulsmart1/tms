# Landing Redesign + Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark, inline-styled landing with a product-forward, light-canvas landing built on the TMS Wizzard design system, plus a `/login` page and a `/api/request-access` lead-capture route, without changing any other page.

**Architecture:** Adopt Tailwind v3.4 mapped to the handoff CSS-variable tokens, with Preflight disabled and fonts/canvas scoped to the new pages so the other ~15 routes stay pixel-identical. Build small reusable primitives (`Button`, `Field`, `Badge`, `Container`) and landing sections, then assemble `/`. Lead capture posts to a Next route-handler that validates with Zod and emails via Resend.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS **3.4** (pinned), IBM Plex Sans/Mono via `next/font`, lucide-react, Zod v4, Resend v6, Supabase (existing), Vitest (new, for validation tests).

**Spec:** `docs/superpowers/specs/2026-07-22-landing-redesign-design.md`

---

## Shared conventions (read once, applies to every task)

- **Imports:** relative paths (no `@/` alias exists). From `components/` to `lib/`, use `../lib/...`. From `app/` to `components/`, use `../components/...` (adjust depth per file).
- **Client vs server:** any file using `useState`/`onClick`/browser APIs starts with `"use client";`. Route handlers and pure modules do not.
- **Styling:** Tailwind utility classes only, using the token-mapped names from `tailwind.config.ts` (`bg-canvas`, `bg-surface`, `text-ink`, `text-ink-2`, `text-ink-3`, `border-line`, `bg-primary`, `text-primary-deep`, `bg-primary-tint`, `border-primary-tint-border`, `text-overline`, `rounded-lg`, `shadow-lg`, etc.). No inline `style=` on new components.
- **Env vars (add to your `.env.local`, document in a comment):** `RESEND_API_KEY`, `MAIL_FROM` (verified sender, dev fallback `onboarding@resend.dev`), `LEAD_INBOX` (recipient, `stuart@adrcarriers.net`).
- **Commits:** one per task, conventional-commit style, at the final step.

## File structure (what gets created / modified)

**Created**
- `tailwind.config.ts` — token-to-class mapping, Preflight off
- `postcss.config.js` — tailwind + autoprefixer
- `app/tokens.css` — CSS variables (light + dark scaffold + focus ring)
- `app/globals.css` — tailwind directives + tokens import
- `lib/cn.ts` — className joiner
- `components/Button.tsx`, `components/Badge.tsx`, `components/Field.tsx`, `components/Container.tsx`
- `components/landing/LandingNav.tsx`, `Hero.tsx`, `FeatureGrid.tsx`, `PricingCard.tsx`, `RequestAccessForm.tsx`, `Footer.tsx`
- `lib/validation/requestAccess.ts` + `lib/validation/requestAccess.test.ts`
- `app/api/request-access/route.ts`
- `app/login/page.tsx`
- `vitest.config.ts`

**Modified**
- `app/layout.tsx` — import globals, expose font variables on `<html>`, leave `<body>` inline styles untouched
- `app/page.tsx` — full rebuild + JSON-LD price fix
- `app/api/auth/callback/route.ts` — error redirects `/` → `/login`
- `package.json` — dependencies + `test` script

**Unchanged:** every other route, `AppHeader`, Supabase client/session logic, the Square subscription files.

---

## Task 1: Design-system config + tokens (Tailwind v3.4, Preflight off)

**Files:**
- Modify: `package.json` (deps)
- Create: `tailwind.config.ts`, `postcss.config.js`, `app/tokens.css`, `app/globals.css`

- [ ] **Step 1: Install pinned dependencies**

Run:
```bash
npm i -D tailwindcss@^3.4 postcss autoprefixer
npm i lucide-react
```
Expected: `package.json` devDependencies now include `tailwindcss` (3.4.x), `postcss`, `autoprefixer`; dependencies include `lucide-react`. Do **not** accept tailwind v4.

- [ ] **Step 2: Create `postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `tailwind.config.ts` (handoff config + `corePlugins.preflight: false`)**

```ts
import type { Config } from "tailwindcss";

/* Classes map to the CSS variables in tokens.css, so a dark theme is a
   variable swap, no class changes. Note: text-base is 14px by design.
   Preflight is OFF so the global reset does not touch the ~15 existing
   inline-styled pages. Re-enable it during the future app-wide restyle. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  corePlugins: { preflight: false },
  theme: {
    fontFamily: {
      sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
    },
    fontSize: {
      overline: ["11px", { lineHeight: "16px", letterSpacing: "0.06em", fontWeight: "600" }],
      xs: ["12px", "16px"],
      sm: ["13px", "18px"],
      base: ["14px", "20px"],
      md: ["16px", "24px"],
      lg: ["18px", "26px"],
      xl: ["24px", "32px"],
      "2xl": ["30px", "36px"],
    },
    boxShadow: {
      xs: "var(--shadow-xs)", sm: "var(--shadow-sm)",
      md: "var(--shadow-md)", lg: "var(--shadow-lg)", none: "none",
    },
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        ink: { DEFAULT: "var(--ink)", 2: "var(--ink-2)", 3: "var(--ink-3)", 4: "var(--ink-4)" },
        primary: {
          DEFAULT: "var(--primary)", hover: "var(--primary-hover)",
          active: "var(--primary-active)", tint: "var(--primary-tint)",
          "tint-border": "var(--primary-tint-border)", deep: "var(--primary-deep)",
          50: "#EEF4FF", 100: "#DFE9FE", 200: "#C5D6FD", 300: "#9DB8FB", 400: "#6C92F6",
          500: "#4470F0", 600: "#2D54DE", 700: "#2444BE", 800: "#21399A", 900: "#20337A", 950: "#16204A",
        },
        accent: { DEFAULT: "var(--accent)", text: "var(--accent-text)", tint: "var(--accent-tint)", border: "var(--accent-border)" },
        success: { DEFAULT: "var(--success)", strong: "var(--success-strong)", tint: "var(--success-tint)", border: "var(--success-border)" },
        warning: { DEFAULT: "var(--warning)", strong: "var(--warning-strong)", tint: "var(--warning-tint)", border: "var(--warning-border)" },
        danger: { DEFAULT: "var(--danger)", hover: "var(--danger-hover)", strong: "var(--danger-strong)", tint: "var(--danger-tint)", border: "var(--danger-border)" },
        focus: "var(--focus)",
      },
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "8px", lg: "12px", xl: "16px" },
      spacing: { 4.5: "18px", 13: "52px", 15: "60px" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 4: Create `app/tokens.css` (handoff tokens)**

```css
/* TMS Wizzard design tokens, imported once from app/globals.css.
   Light is the default; .dark is a scaffold for later (apply class on <html>). */
:root {
  --canvas: #F4F6F8;   --surface: #FFFFFF;   --surface-2: #F8FAFC;
  --line: #E2E8F0;     --line-strong: #CBD5E1;
  --ink: #0F172A;      --ink-2: #475569;     --ink-3: #64748B;   --ink-4: #94A3B8;
  --primary: #2D54DE;  --primary-hover: #2444BE;  --primary-active: #21399A;
  --primary-tint: #EEF4FF;  --primary-tint-border: #C5D6FD;  --primary-deep: #21399A;
  --accent: #D97706;   --accent-text: #B45309;  --accent-tint: #FFFBEB;  --accent-border: #FDE68A;
  --success: #15803D;  --success-strong: #166534;  --success-tint: #F0FDF4;  --success-border: #BBF7D0;
  --warning: #B45309;  --warning-strong: #92400E;  --warning-tint: #FFFBEB;  --warning-border: #FDE68A;
  --danger: #DC2626;   --danger-hover: #B91C1C;  --danger-strong: #991B1B;  --danger-tint: #FEF2F2;  --danger-border: #FECACA;
  --focus: #2D54DE;
  --shadow-xs: 0 1px 2px rgba(15,23,42,.05);
  --shadow-sm: 0 1px 2px rgba(15,23,42,.05), 0 2px 8px -2px rgba(15,23,42,.08);
  --shadow-md: 0 4px 16px -4px rgba(15,23,42,.12), 0 2px 4px -2px rgba(15,23,42,.06);
  --shadow-lg: 0 16px 40px -8px rgba(15,23,42,.22);
}
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 5: Create `app/globals.css` (tokens FIRST, then directives)**

> **Ordering is load-bearing.** CSS requires `@import` to precede all other rules, so postcss-import silently DROPS a late `@import`. Putting `@import "./tokens.css"` after the `@tailwind` directives strips the entire `:root` token block from the compiled output, leaving every token-backed utility (`bg-canvas`, `text-ink`, `border-line`, the whole colour map) resolving against undefined variables. Verified by compiling both orderings: the tokens are present with the import first and absent with it last. The handoff README says "after the @tailwind directives"; the handoff README is wrong on this point.

```css
@import "./tokens.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Preflight is OFF (see tailwind.config.ts) so the global reset does not touch
   the other ~15 pages. We instead scope the essential resets to the ".ds"
   wrapper that the landing and /login apply to their root element. Without
   this: `border` utilities render nothing (CSS default border-style is none),
   content-box sizing overflows containers, native buttons/inputs ignore the
   Plex font, and UA heading/paragraph margins drift the spacing. Scoped to
   .ds, so the inline-styled existing pages are untouched. */
@layer base {
  .ds, .ds *, .ds ::before, .ds ::after {
    box-sizing: border-box;
    border-width: 0;
    border-style: solid;
    border-color: var(--line);
  }
  .ds h1, .ds h2, .ds h3, .ds h4, .ds p, .ds figure, .ds ul, .ds ol { margin: 0; }
  .ds button, .ds [type="button"], .ds [type="submit"] {
    -webkit-appearance: none;
    appearance: none;
    background-image: none;
  }
  .ds button, .ds input, .ds textarea, .ds select {
    font-family: inherit;
    font-size: 100%;
    line-height: inherit;
    color: inherit;
  }
  .ds button { cursor: pointer; }
}
```

> **Why `.ds` and not global:** Tailwind's Preflight normally injects these resets on `*`. We turned Preflight off to protect the other pages, so we re-add only what the new pages need, scoped behind `.ds`. The landing root (`app/page.tsx`) and the `/login` root (`app/login/page.tsx`) both carry `className="ds ..."`. Utilities still win over these base rules (utilities layer > base layer), so `border`, `border-2`, etc. paint correctly.

- [ ] **Step 6: Verify the build compiles with the new toolchain**

Run: `npm run build`
Expected: build succeeds. If it errors with a message about `@tailwindcss/postcss` or "PostCSS plugin", you installed tailwind v4 by mistake, redo Step 1 pinning `tailwindcss@^3.4`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts postcss.config.js app/tokens.css app/globals.css
git commit -m "feat: add Tailwind v3.4 design-system foundation (preflight off)"
```

---

## Task 2: Wire globals + fonts into the root layout (scoped)

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace `app/layout.tsx` with the version below**

Loads globals so Tailwind works, exposes the Plex font variables on `<html>`, and **leaves `<body>` inline styles unchanged** so the other pages keep Inter and their current background.

```tsx
import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import AppHeader from "./components/AppHeader";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TMS Wizzard",
  description: "Transport Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0f172a",
          color: "#0f172a",
        }}
      >
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify an existing page is visually unchanged**

Run: `npm run dev`, open `http://localhost:3000/dashboard`.
Expected: identical to before (still Inter, still its own background). The font variables are declared but not applied to `<body>`, and Preflight is off, so nothing shifts.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: load globals + Plex font variables in root layout (scoped)"
```

---

## Task 3: `cn` helper + Button + Badge primitives

**Files:**
- Create: `lib/cn.ts`, `components/Button.tsx`, `components/Badge.tsx`

- [ ] **Step 1: Create `lib/cn.ts`**

```ts
/** Join truthy class names into one string. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
```

- [ ] **Step 2: Create `components/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:bg-danger-hover",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 h-9",
  md: "text-base px-4 h-10",
  lg: "text-base px-5 h-11",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? "Please wait..." : children}
    </button>
  );
}
```

- [ ] **Step 3: Create `components/Badge.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const tones: Record<Tone, string> = {
  info: "bg-primary-tint text-primary-deep border-primary-tint-border",
  success: "bg-success-tint text-success-strong border-success-border",
  warning: "bg-warning-tint text-warning-strong border-warning-border",
  danger: "bg-danger-tint text-danger-strong border-danger-border",
  neutral: "bg-surface-2 text-ink-2 border-line",
};

export default function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/cn.ts components/Button.tsx components/Badge.tsx
git commit -m "feat: add cn helper, Button, and Badge primitives"
```

---

## Task 4: Field + Container primitives

**Files:**
- Create: `components/Field.tsx`, `components/Container.tsx`

- [ ] **Step 1: Create `components/Field.tsx`**

Labelled input wired for AA: real `<label for>`, hint via `aria-describedby`, error via `role="alert"`.

```tsx
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

export default function Field({ id, label, hint, error, className, ...props }: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 rounded-md border bg-surface px-3 text-base text-ink placeholder:text-ink-4",
          error ? "border-danger" : "border-line-strong",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/Container.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export default function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 md:px-8", className)}>{children}</div>;
}
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/Field.tsx components/Container.tsx
git commit -m "feat: add Field and Container primitives"
```

---

## Task 5: Request-access validation schema (TDD)

**Files:**
- Create: `lib/validation/requestAccess.ts`, `lib/validation/requestAccess.test.ts`, `vitest.config.ts`
- Modify: `package.json` (test script + vitest dev dep)

- [ ] **Step 1: Install Vitest**

Run: `npm i -D vitest`
Then add to `package.json` `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the failing test `lib/validation/requestAccess.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { RequestAccessValidation } from "./requestAccess";

describe("RequestAccessValidation", () => {
  const valid = {
    companyName: "ADR Carriers",
    contactName: "Stuart",
    email: "stuart@adrcarriers.net",
    phone: "",
    vehicles: "12",
    notes: "",
  };

  it("accepts a valid payload and coerces vehicles to a number", () => {
    const parsed = RequestAccessValidation.parse(valid);
    expect(parsed.vehicles).toBe(12);
    expect(parsed.companyName).toBe("ADR Carriers");
  });

  it("rejects a missing company name", () => {
    const result = RequestAccessValidation.safeParse({ ...valid, companyName: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects a bad email", () => {
    const result = RequestAccessValidation.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects zero or negative vehicles", () => {
    expect(RequestAccessValidation.safeParse({ ...valid, vehicles: "0" }).success).toBe(false);
    expect(RequestAccessValidation.safeParse({ ...valid, vehicles: "-3" }).success).toBe(false);
  });

  it("allows optional phone and notes to be empty", () => {
    const parsed = RequestAccessValidation.parse({ ...valid, phone: "", notes: "" });
    expect(parsed.phone).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run lib/validation/requestAccess.test.ts`
Expected: FAIL, cannot import `RequestAccessValidation` (module not found).

- [ ] **Step 5: Implement `lib/validation/requestAccess.ts`**

```ts
import { z } from "zod";

/* Validates the landing "Request access" form. Mirrors the pattern in
   lib/supabase/validation/job.ts: trim strings, coerce numbers, empty
   optional fields become undefined. */
const emptyToUndefined = (val: unknown) => (val === "" ? undefined : val);

export const RequestAccessValidation = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  contactName: z.string().trim().min(1, "Contact name is required."),
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  phone: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  vehicles: z.coerce
    .number({ error: "Enter how many vehicles you run." })
    .int("Enter a whole number.")
    .positive("Enter at least one vehicle."),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

export type RequestAccessInput = z.infer<typeof RequestAccessValidation>;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run lib/validation/requestAccess.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/validation/requestAccess.ts lib/validation/requestAccess.test.ts
git commit -m "feat: add request-access Zod schema with vitest coverage"
```

---

## Task 6: `/api/request-access` route (Resend)

**Files:**
- Create: `app/api/request-access/route.ts`

- [ ] **Step 1: Create `app/api/request-access/route.ts`**

Validates with the schema from Task 5, emails via Resend, returns typed JSON. Field errors come back as a flat map for the client.

```ts
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { RequestAccessValidation } from "../../../lib/validation/requestAccess";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = RequestAccessValidation.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ ok: false, fieldErrors }, { status: 400 });
  }

  const { companyName, contactName, email, phone, vehicles, notes } = parsed.data;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.LEAD_INBOX;
  if (!apiKey || !from || !to) {
    console.error("request-access: missing RESEND_API_KEY / MAIL_FROM / LEAD_INBOX");
    return NextResponse.json({ ok: false, error: "Server is not configured to receive requests." }, { status: 500 });
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    replyTo: email,
    subject: `New access request: ${companyName}`,
    text: [
      `Company: ${companyName}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      `Phone: ${phone ?? "-"}`,
      `Vehicles: ${vehicles}`,
      `Notes: ${notes ?? "-"}`,
    ].join("\n"),
  });

  if (error) {
    console.error("request-access: Resend send failed", error);
    return NextResponse.json({ ok: false, error: "Could not send your request. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (with env vars set)**

Set `RESEND_API_KEY`, `MAIL_FROM` (dev: `onboarding@resend.dev`), `LEAD_INBOX` in `.env.local`, run `npm run dev`, then:
```bash
curl -s -X POST http://localhost:3000/api/request-access -H "Content-Type: application/json" -d '{"companyName":"ADR","contactName":"Stu","email":"stu@example.com","phone":"","vehicles":"5","notes":""}'
```
Expected: `{"ok":true}` and an email arrives at `LEAD_INBOX`. A bad payload (e.g. `"vehicles":"0"`) returns `{"ok":false,"fieldErrors":{...}}` with status 400.

- [ ] **Step 4: Create `.env.example` + Resend runbook note**

Create `.env.example` (committed, no real secrets):

```bash
# Resend (powers the landing "Request access" email)
RESEND_API_KEY=                    # from the Resend dashboard
MAIL_FROM=onboarding@resend.dev    # dev fallback; use a verified-domain sender in prod
LEAD_INBOX=stuart@adrcarriers.net  # where access requests are emailed
```

**Runbook note** (put in the PR description or a README section): before live sends work, verify a sending domain in Resend by adding the DNS records it provides for `adrcarriers.net`, then set `MAIL_FROM` to an address on that domain. Until verified, `onboarding@resend.dev` works for local/dev only, and real sends to arbitrary inboxes will fail.

- [ ] **Step 5: Commit**

```bash
git add app/api/request-access/route.ts .env.example
git commit -m "feat: add request-access API route (Zod + Resend) + env example"
```

---

## Task 7: Landing sections part 1 (Nav, Hero, Footer)

**Files:**
- Create: `components/landing/LandingNav.tsx`, `components/landing/Hero.tsx`, `components/landing/Footer.tsx`

- [ ] **Step 1: Create `components/landing/LandingNav.tsx`**

Sticky, ~56px. Desktop shows anchors + Sign in + Get started; mobile collapses anchors behind a disclosure toggle, keeps the primary CTA visible.

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import Button from "../Button";
import Container from "../Container";

const anchors = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#request-access", label: "Contact" },
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <Container className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-md bg-primary" aria-hidden />
          <span className="text-base font-semibold text-ink">TMS Wizzard</span>
        </div>

        <nav className="hidden items-center gap-6 md:flex">
          {anchors.map((a) => (
            <a key={a.href} href={a.href} className="text-sm text-ink-2 hover:text-ink">
              {a.label}
            </a>
          ))}
          <Link href="/login" className="text-sm font-semibold text-ink">
            Sign in
          </Link>
          <a href="#request-access">
            <Button size="sm">Get started</Button>
          </a>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <a href="#request-access">
            <Button size="sm">Get started</Button>
          </a>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-md border border-line-strong text-ink"
          >
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </Container>

      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-surface md:hidden">
          <Container className="flex flex-col gap-3 py-3">
            {anchors.map((a) => (
              <a key={a.href} href={a.href} className="text-base text-ink-2" onClick={() => setOpen(false)}>
                {a.label}
              </a>
            ))}
            <Link href="/login" className="text-base font-semibold text-ink" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 2: Create `components/landing/Hero.tsx`**

Two-column hero. Left: copy + dual CTA. Right: a product mock (jobs table) using `Badge`. Stacks under 820px via `lg:` breakpoints.

```tsx
import Link from "next/link";
import Button from "../Button";
import Badge from "../Badge";
import Container from "../Container";

function ProductMock() {
  const rows = [
    { ref: "TMS-2381", customer: "ADR Carriers", tone: "info" as const, status: "In transit", value: "£12,480" },
    { ref: "TMS-2380", customer: "Northgate Ltd", tone: "success" as const, status: "Delivered", value: "£3,940" },
    { ref: "TMS-2379", customer: "Baxter Freight", tone: "warning" as const, status: "Awaiting POD", value: "£1,220" },
  ];
  return (
    <div
      className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lg"
      role="img"
      aria-label="TMS Wizzard jobs dashboard showing three transport jobs with statuses and values"
    >
      <div className="border-b border-line bg-surface-2 px-4 py-3 text-sm font-semibold text-ink">Jobs — today</div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-overline uppercase text-ink-3">
            <th className="px-4 py-2 text-left font-semibold">Ref</th>
            <th className="px-4 py-2 text-left font-semibold">Customer</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
            <th className="px-4 py-2 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref} className="border-t border-line">
              <td className="px-4 py-2 font-mono text-ink-2">{r.ref}</td>
              <td className="px-4 py-2 text-ink">{r.customer}</td>
              <td className="px-4 py-2"><Badge tone={r.tone}>{r.status}</Badge></td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-ink">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="py-12 md:py-16">
      <Container className="grid items-center gap-10 min-[820px]:grid-cols-2">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary-tint-border bg-primary-tint px-3 py-1 text-overline uppercase text-primary-deep">
            All-in-one cloud TMS
          </span>
          <h1 className="mt-4 text-2xl font-semibold leading-tight text-ink sm:text-[34px] sm:leading-[1.1]">
            Run your whole transport operation in one place.
          </h1>
          <p className="mt-3 max-w-md text-md leading-relaxed text-ink-2">
            Jobs, proof of delivery, invoicing, fleet, drivers and subcontractors, one cloud platform built for UK and European haulage.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#request-access"><Button size="lg">Get started</Button></a>
            <Link href="/login"><Button size="lg" variant="secondary">Sign in</Button></Link>
          </div>
          <p className="mt-4 text-xs text-ink-3">Built for UK &amp; EU operators · WCAG 2.1 AA · Your data stays yours</p>
        </div>
        <ProductMock />
      </Container>
    </section>
  );
}
```

- [ ] **Step 3: Create `components/landing/Footer.tsx`**

```tsx
import Container from "../Container";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="flex flex-col items-start justify-between gap-3 py-6 text-xs text-ink-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 rounded bg-line-strong" aria-hidden />
          TMS Wizzard · Cloud transport management
        </div>
        <div className="flex gap-4">
          <a href="#" className="hover:text-ink-2">Privacy</a>
          <a href="#" className="hover:text-ink-2">Terms</a>
          <a href="#request-access" className="hover:text-ink-2">Contact</a>
        </div>
      </Container>
    </footer>
  );
}
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/landing/LandingNav.tsx components/landing/Hero.tsx components/landing/Footer.tsx
git commit -m "feat: add landing nav, hero, and footer sections"
```

---

## Task 8: Landing sections part 2 (FeatureGrid, PricingCard, RequestAccessForm)

**Files:**
- Create: `components/landing/FeatureGrid.tsx`, `components/landing/PricingCard.tsx`, `components/landing/RequestAccessForm.tsx`

- [ ] **Step 1: Create `components/landing/FeatureGrid.tsx`**

```tsx
import {
  ClipboardList, PackageCheck, ReceiptText, Truck,
  UserRound, Network, MapPin, ShieldCheck,
} from "lucide-react";
import Container from "../Container";

const features = [
  { icon: ClipboardList, title: "Jobs Management", body: "Plan, assign, dispatch." },
  { icon: PackageCheck, title: "POD Capture", body: "Signatures & photos." },
  { icon: ReceiptText, title: "Transport Invoicing", body: "Bill and reconcile." },
  { icon: Truck, title: "Fleet Management", body: "Vehicles & assets." },
  { icon: UserRound, title: "Driver Management", body: "Hours and licences." },
  { icon: Network, title: "Subcontractors", body: "Rates and control." },
  { icon: MapPin, title: "Live Tracking", body: "Real-time positions." },
  { icon: ShieldCheck, title: "Compliance & Tacho", body: "Stay road-legal." },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="border-y border-line bg-surface py-12 md:py-16">
      <Container>
        <p className="text-overline uppercase text-ink-3">Everything in one place</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">One platform, the whole operation</h2>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-line p-4">
              <Icon size={20} strokeWidth={2} className="text-primary" aria-hidden />
              <h3 className="mt-2 text-base font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-3">{body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 2: Create `components/landing/PricingCard.tsx`**

```tsx
import Container from "../Container";

export default function PricingCard() {
  return (
    <section id="pricing" className="py-12 md:py-16">
      <Container className="text-center">
        <p className="text-overline uppercase text-ink-3">Pricing</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Simple, per-vehicle pricing</h2>
        <div className="mx-auto mt-6 inline-block rounded-lg border-2 border-primary bg-surface p-6 text-left">
          <div className="text-2xl font-semibold text-ink">
            £10 <span className="text-sm font-normal text-ink-3">/ vehicle / month</span>
          </div>
          <p className="mt-2 text-sm text-ink-2">Every module included · no setup fee</p>
          <a href="#request-access" className="mt-4 block">
            <span className="block rounded-md bg-primary px-4 py-2 text-center text-base font-semibold text-white hover:bg-primary-hover">
              Request access
            </span>
          </a>
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 3: Create `components/landing/RequestAccessForm.tsx`**

Client component. Posts to `/api/request-access`, shows inline field errors, disables while sending, swaps to a confirmation on success.

```tsx
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Field from "../Field";
import Button from "../Button";
import Container from "../Container";

type FieldErrors = Partial<Record<"companyName" | "contactName" | "email" | "phone" | "vehicles" | "notes", string[]>>;

export default function RequestAccessForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDone(true);
        return;
      }
      if (data.fieldErrors) setErrors(data.fieldErrors as FieldErrors);
      setMessage(data.error ?? "Please check the highlighted fields.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="request-access" className="border-t border-line bg-surface py-12 md:py-16">
      <Container className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold text-ink">Request access</h2>
          <p className="mt-2 max-w-sm text-base text-ink-2">
            Tell us about your operation and we&apos;ll get you set up. Self-serve signup is coming soon.
          </p>
          <p className="mt-3 text-sm text-ink-3">
            Already a customer?{" "}
            <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">Sign in</Link>
          </p>
        </div>

        {done ? (
          <div className="rounded-lg border border-success-border bg-success-tint p-6" role="status">
            <p className="text-base font-semibold text-success-strong">Request sent.</p>
            <p className="mt-1 text-sm text-ink-2">Thanks. We will be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:p-6" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="companyName" name="companyName" label="Company name" required error={errors.companyName?.[0]} />
              <Field id="contactName" name="contactName" label="Contact name" required error={errors.contactName?.[0]} />
              <Field id="email" name="email" type="email" label="Email" required error={errors.email?.[0]} />
              <Field id="phone" name="phone" label="Phone (optional)" error={errors.phone?.[0]} />
              <Field id="vehicles" name="vehicles" type="number" min={1} label="Vehicles" required error={errors.vehicles?.[0]} />
            </div>
            <Field id="notes" name="notes" label="Notes (optional)" error={errors.notes?.[0]} />
            {message ? <p role="alert" className="text-sm text-danger-strong">{message}</p> : null}
            <Button type="submit" size="lg" loading={loading}>Request access</Button>
          </form>
        )}
      </Container>
    </section>
  );
}
```

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/landing/FeatureGrid.tsx components/landing/PricingCard.tsx components/landing/RequestAccessForm.tsx
git commit -m "feat: add feature grid, pricing card, and request-access form"
```

---

## Task 9: Assemble the landing page `/` (+ JSON-LD fix)

**Files:**
- Modify: `app/page.tsx` (full replacement)

- [ ] **Step 1: Replace `app/page.tsx` with the composed landing**

Server component (no client hooks at the page level; the form and nav are their own client components). Keeps JSON-LD but fixes the price to £10.

```tsx
import Script from "next/script";
import LandingNav from "../components/landing/LandingNav";
import Hero from "../components/landing/Hero";
import FeatureGrid from "../components/landing/FeatureGrid";
import PricingCard from "../components/landing/PricingCard";
import RequestAccessForm from "../components/landing/RequestAccessForm";
import Footer from "../components/landing/Footer";

export default function HomePage() {
  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <Script
        id="tmswizzard-ld-json"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "TMS Wizzard",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Cloud transport management software for jobs, proof of delivery, invoicing, vehicles, drivers, subcontractors, dispatch, and fleet management.",
            offers: {
              "@type": "Offer",
              price: "10",
              priceCurrency: "GBP",
              description: "Per vehicle per month",
            },
          }),
        }}
      />
      <LandingNav />
      <main>
        <Hero />
        <FeatureGrid />
        <PricingCard />
        <RequestAccessForm />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Visual check**

Run: `npm run dev`, open `http://localhost:3000/`.
Expected: light-canvas landing, sticky nav, hero with the jobs-table mock, 8-card feature grid, £10 pricing card, working form layout, footer. Resize to mobile width: hero and grid stack, nav collapses to the menu toggle, no horizontal scroll.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: rebuild landing page on the design system (product-forward)"
```

---

## Task 10: `/login` page

**Files:**
- Create: `app/login/page.tsx`

- [ ] **Step 1: Create `app/login/page.tsx`**

Re-skins the existing magic-link sign-in and reads `?error=` (now redirected here by the callback in Task 11).

```tsx
"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";
import Field from "../../components/Field";
import Button from "../../components/Button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setMessage("That sign-in link didn't work or has expired. Enter your email and we'll send a fresh one.");
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage("Please enter your email address.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/api/auth/callback?next=/dashboard`;
      const { error } = await supabase.auth.signInWithOtp({ email: trimmed, options: { emailRedirectTo: redirectTo } });
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage("Login link sent. Check your email.");
      setEmail("");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to start login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ds grid min-h-screen place-items-center bg-canvas font-sans text-ink px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        <Link href="/" className="text-sm text-ink-3 hover:text-ink-2">← Back</Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">We&apos;ll email you a magic link.</p>
        <form onSubmit={handleLogin} className="mt-4 grid gap-4">
          <Field
            id="email"
            type="email"
            label="Email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="lg" loading={loading}>Send login link</Button>
        </form>
        {message ? <p className="mt-4 text-sm text-ink-2" role="status">{message}</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Visual check**

Run: `npm run dev`, open `http://localhost:3000/login`.
Expected: centered card in the new system; submitting a real email shows "Login link sent." `AppHeader` does not appear (it only renders for signed-in non-landing routes; a signed-out visitor sees none).

- [ ] **Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: add /login page in the design system"
```

---

## Task 11: Repoint auth-callback errors to `/login`

**Files:**
- Modify: `app/api/auth/callback/route.ts:30-31` and `:57-60`

- [ ] **Step 1: Change the two error redirects from `/` to `/login`**

In `app/api/auth/callback/route.ts`, replace the missing-code redirect:

```ts
  if (!tokenHash && !code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }
```

and the verification-failure redirect:

```ts
  if (error) {
    console.error("magic link verification failed", error.message);
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }
```

Leave the success path and `safeNextPath` untouched.

- [ ] **Step 2: Verify type-check + the recovery path**

Run: `npx tsc --noEmit` (expected: clean). Then `npm run dev` and open `http://localhost:3000/api/auth/callback` with no params.
Expected: it redirects to `/login?error=missing_code`, and `/login` shows the "link didn't work" message with the email field.

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/callback/route.ts
git commit -m "fix: redirect magic-link errors to /login instead of /"
```

---

## Task 12: Full verification + regression pass

**Files:** none (verification only)

- [ ] **Step 1: Build and type-check**

Run: `npm run build` then `npx tsc --noEmit`
Expected: both succeed with no errors.

- [ ] **Step 2: Run the unit tests**

Run: `npm test`
Expected: the request-access validation suite passes.

- [ ] **Step 3: Regression spot-check (Preflight-off proof)**

Run `npm run dev` and open each: `/dashboard`, `/jobs`, `/super-admin`.
Expected: each looks identical to before this branch (still Inter, still its own background/layout). If any shifted, Preflight leaked, recheck `corePlugins.preflight: false` in `tailwind.config.ts`.

- [ ] **Step 4: Landing + login acceptance**

- `/` renders correctly on desktop and at 375px width (no horizontal scroll; hero/grid/nav collapse). Borders, buttons, and the Plex font all render, which proves the scoped `.ds` reset works.
- `/login` sends a link; visiting the callback with no params lands on `/login` with the retry message. Then complete one real magic-link round trip so a valid link redirects through the callback to `/dashboard` (verifies the success branch, not just the error branch).
- Request-access: a valid submit returns `{ok:true}` and shows the confirmation panel; `vehicles: 0` shows an inline error under that field; with `RESEND_API_KEY` unset or wrong, a submit shows the friendly retry message (the 500 path).
- JSON-LD price: `curl -s localhost:3000/ | grep -o '"price":"[0-9]*"'` shows `"price":"10"`, and `"0"` no longer appears in the `ld+json` block.

- [ ] **Step 5: Accessibility pass**

Run an axe or Lighthouse check on `/` and `/login`.
Expected: no colour-contrast or missing-label violations. Tab through the page: focus ring is visible on every interactive element; the mobile menu button reports `aria-expanded`.

- [ ] **Step 6: Final commit (if any doc/env notes changed)**

```bash
git add -A
git commit -m "chore: landing redesign verification notes"
```

---

## Self-review notes (author) — updated after 5-lens verification

A five-agent correctness pass ran over this plan against the installed packages. Findings folded in:

- **Preflight-off reset (critical fix):** because `corePlugins.preflight` is off, a scoped `@layer base { .ds ... }` block in `app/globals.css` restores box-sizing, border-style, control font inheritance, and heading margins. The landing and `/login` roots carry `className="ds ..."`. Without it, borders would be invisible, containers would overflow into horizontal scroll, and buttons/inputs would ignore Plex. Scoped to `.ds`, so the other ~15 pages are untouched.
- **Zod v4:** uses `z.email(...)` (via `.pipe`) and `z.coerce.number({ error })`, the non-deprecated v4 forms. The v3 `required_error`/`invalid_type_error` keys would not work here.
- **Hero breakpoint:** `min-[820px]:grid-cols-2` matches the spec's ~820px collapse point (default `lg` is 1024px).
- **`Section` primitive:** intentionally not built. Each landing piece uses a raw `<section>` with `py-12 md:py-16`. Deliberate deviation from spec section 8, to avoid a low-value wrapper.
- **lucide-react icons:** after `npm i lucide-react` (Task 1), the type-check in Tasks 7-8 fails loudly if any of `ClipboardList, PackageCheck, ReceiptText, Truck, UserRound, Network, MapPin, ShieldCheck, Menu, X` is misnamed. All ten are valid lucide exports.
- **Env docs:** `.env.example` + Resend DNS runbook added to Task 6. Domain must be verified before live sends; dev uses `onboarding@resend.dev`.
- **Cross-task consistency:** verified clean, no findings (component prop names, import depths, `FieldErrors` keys all align).
- **Spec coverage:** foundation (Task 1-2), `/login` + callback (Task 10-11), request-access route + Resend + env (Task 5-6), all six landing sections (Task 7-9), JSON-LD price fix (Task 9), responsive + a11y + regression + JSON-LD/send-failure/sign-in checks (Task 12).
