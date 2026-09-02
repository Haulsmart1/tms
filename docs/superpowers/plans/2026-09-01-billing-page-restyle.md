# Billing Page Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/settings/billing` onto the shared console components (Card, Button, Badge, DataTable, MessageBanner, Field, Skeleton) in the agreed two-card layout, with real loading states and the route added to `SKELETON_READY_ROUTES`.

**Architecture:** Two pure helpers land first in `lib/billing/` (vitest only covers `lib/`), then `SquareCardForm` is restyled in place, then two new loading-aware card components are built, and finally `app/settings/billing/page.tsx` is rewritten to compose them. No charge logic, cron, or API route changes. Spec: `docs/superpowers/specs/2026-09-01-billing-page-restyle-design.md`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind (Preflight off, `ds` scoped reset), Supabase browser client, vitest, lucide-react.

**Conventions to respect throughout:**

- No em-dashes anywhere (code, comments, copy, commit messages). Use "-" as the empty-cell glyph.
- Every component here renders inside the page's `ds` wrapper; do not add `dark:` variants.
- `lib/cn.ts` composes classes, it does not override. Never pass a className expecting it to beat a component's base class.
- Commit messages end with the two trailer lines shown in each commit step.
- Branch: `ethan/billing-page-restyle` (already created, spec committed on it).

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/billing/money.ts` (modify) | Add `formatPence`. Owns all money maths and formatting. |
| `lib/billing/money.test.ts` (modify) | Add `formatPence` cases. |
| `lib/billing/format.ts` (create) | `formatCycleDate` and `billingStatusBadge`: display formatting with no money maths. |
| `lib/billing/format.test.ts` (create) | Tests for both. |
| `lib/nav/skeletonReadyRoutes.ts` + `.test.ts` (modify) | Add `/settings/billing`. |
| `components/billing/SquareCardForm.tsx` (modify) | Restyle with `Field`, `Button`, `MessageBanner`; add `submitLabel` and `onCancel` props. SDK logic untouched. |
| `app/settings/billing/NextInvoiceCard.tsx` (create) | The net / VAT / total breakdown card, with its own skeleton. |
| `app/settings/billing/PaymentMethodCard.tsx` (create) | Card-on-file display, replace flow, first-time setup form, with its own skeleton. Exports the `BillingRow` type. |
| `app/settings/billing/page.tsx` (rewrite) | Data loading, gating, stat row, the two cards, the `DataTable`. |

---

### Task 1: `formatPence` in `lib/billing/money.ts`

**Files:**
- Modify: `lib/billing/money.ts`
- Test: `lib/billing/money.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `lib/billing/money.test.ts`. Also add `formatPence` to the import list at the top of the file:

```ts
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
  formatPence,
} from "./money";
```

Append at the end of the file:

```ts
describe("formatPence", () => {
  it("formats zero", () => {
    expect(formatPence(0)).toBe("£0.00");
  });

  it("formats whole pounds with two decimals", () => {
    expect(formatPence(1000)).toBe("£10.00");
  });

  it("formats pence", () => {
    expect(formatPence(5)).toBe("£0.05");
    expect(formatPence(14400)).toBe("£144.00");
  });

  it("does not group thousands, matching the page's existing pounds() helper", () => {
    expect(formatPence(123456789)).toBe("£1234567.89");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: FAIL. The import of `formatPence` resolves to `undefined`, so the `formatPence` describe block errors with "formatPence is not a function".

- [x] **Step 3: Implement `formatPence`**

Add to `lib/billing/money.ts`, directly after the `computeChargeAmounts` function (before the `chargeIdempotencyKey` comment):

```ts
// Display formatting for integer pence. No thousands grouping: this matches
// the helper it replaces on /settings/billing, and platform charges are small.
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: PASS, all tests in the file green (the existing `computeChargeAmounts`, `chargeIdempotencyKey`, `classifyPaymentResult` suites plus the four new `formatPence` cases).

- [x] **Step 5: Commit**

```bash
git add lib/billing/money.ts lib/billing/money.test.ts
git commit -F - <<'EOF'
feat(billing): add formatPence to the money module

Moves the page-local pounds() helper into lib so both the page and the
new NextInvoiceCard share one definition, and so it is unit tested.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 2: `lib/billing/format.ts` (date and status badge helpers)

**Files:**
- Create: `lib/billing/format.ts`
- Test: `lib/billing/format.test.ts`

- [x] **Step 1: Write the failing tests**

Create `lib/billing/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { billingStatusBadge, formatCycleDate } from "./format";

/* vitest.config.ts pins TZ=Europe/London. The DST cases below are only
   meaningful under that pin; do not "fix" a failure by changing it. */
describe("formatCycleDate", () => {
  it("formats a YYYY-MM-DD cycle date as dd/mm/yyyy, like the rest of the app", () => {
    expect(formatCycleDate("2026-10-01")).toBe("01/10/2026");
  });

  it("does not shift the day across the spring DST boundary", () => {
    // BST begins 2026-03-29 at 01:00 local time.
    expect(formatCycleDate("2026-03-29")).toBe("29/03/2026");
  });

  it("does not shift the day across the autumn DST boundary", () => {
    // BST ends 2026-10-25 at 02:00 local time.
    expect(formatCycleDate("2026-10-25")).toBe("25/10/2026");
  });

  it("returns an unparseable input unchanged rather than 'Invalid Date'", () => {
    expect(formatCycleDate("not-a-date")).toBe("not-a-date");
    expect(formatCycleDate("")).toBe("");
  });
});

describe("billingStatusBadge", () => {
  it("maps active to a success badge", () => {
    expect(billingStatusBadge("active")).toEqual({ tone: "success", label: "Active" });
  });

  it("maps past_due to a danger badge", () => {
    expect(billingStatusBadge("past_due")).toEqual({ tone: "danger", label: "Past due" });
  });

  it("maps canceled to a warning badge with UK spelling", () => {
    expect(billingStatusBadge("canceled")).toEqual({ tone: "warning", label: "Cancelled" });
  });

  it("maps a missing billing row to a neutral 'Not set up' badge", () => {
    expect(billingStatusBadge(null)).toEqual({ tone: "neutral", label: "Not set up" });
    expect(billingStatusBadge(undefined)).toEqual({ tone: "neutral", label: "Not set up" });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/format.test.ts`
Expected: FAIL with "Failed to resolve import "./format"" (the module does not exist yet).

- [x] **Step 3: Implement the module**

Create `lib/billing/format.ts`:

```ts
// Display helpers for the billing page. No money maths lives here; that is
// lib/billing/money.ts. Kept in lib/ so vitest reaches it.

export type BillingStatus = "active" | "past_due" | "canceled";

/* A subset of components/Badge's Tone. Declared here rather than imported so
   this module stays free of component imports; the subset is assignable to
   Badge's `tone` prop at the call site. */
export type BadgeTone = "success" | "danger" | "warning" | "neutral";

/* Parses a YYYY-MM-DD cycle date as LOCAL midnight before formatting. A bare
   `new Date("2026-10-01")` parses as UTC midnight, which in a negative-offset
   timezone formats as the previous day. The T00:00:00 suffix is the /drivers
   page's existing pattern for the same problem. */
export function formatCycleDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB");
}

export function billingStatusBadge(
  status: BillingStatus | null | undefined
): { tone: BadgeTone; label: string } {
  switch (status) {
    case "active":
      return { tone: "success", label: "Active" };
    case "past_due":
      return { tone: "danger", label: "Past due" };
    case "canceled":
      return { tone: "warning", label: "Cancelled" };
    default:
      return { tone: "neutral", label: "Not set up" };
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/format.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add lib/billing/format.ts lib/billing/format.test.ts
git commit -F - <<'EOF'
feat(billing): add formatCycleDate and billingStatusBadge helpers

Local-midnight date parsing (the /drivers pattern) and the status-to-badge
mapping the restyled page uses, both unit tested.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 3: Add `/settings/billing` to `SKELETON_READY_ROUTES`

This task lands the allowlist entry before the page is converted. That is the reverse of the order the file's own header comment demands, so it is committed together with the page in Task 7, not on its own. Do Steps 1 to 4 now; the commit is in Task 7.

**Files:**
- Modify: `lib/nav/skeletonReadyRoutes.ts`
- Modify: `lib/nav/skeletonReadyRoutes.test.ts`

- [x] **Step 1: Update the exhaustive test**

In `lib/nav/skeletonReadyRoutes.test.ts`, replace the final test:

```ts
  it("lists exactly the routes converted so far, and nothing aspirational", () => {
    expect([...SKELETON_READY_ROUTES].sort()).toEqual(
      ["/dashboard", "/customers", "/settings/billing"].sort()
    );
  });
```

Also add one case above it, after the "matches exactly" test:

```ts
  it("returns true for the billing settings page", () => {
    expect(isSkeletonReadyRoute("/settings/billing")).toBe(true);
    expect(isSkeletonReadyRoute("/settings/billing/")).toBe(true);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/nav/skeletonReadyRoutes.test.ts`
Expected: FAIL, two tests: the exhaustive list mismatch and the new `/settings/billing` case returning false.

- [x] **Step 3: Add the route**

In `lib/nav/skeletonReadyRoutes.ts`, replace the array:

```ts
export const SKELETON_READY_ROUTES: readonly string[] = [
  "/dashboard",               // app/dashboard/page.tsx
  "/customers",               // app/customers/page.tsx
  "/settings/billing",        // app/settings/billing/page.tsx
];
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/nav/skeletonReadyRoutes.test.ts`
Expected: PASS, 7 tests.

Do NOT commit yet. Until Task 7 lands, this entry makes `TenantGate` pass through on a page that does not yet draw a skeleton, which is exactly the misuse the file's comment warns about. It is committed with the page.

---

### Task 4: Restyle `SquareCardForm`

Logic is untouched: the SDK loader, `tokenize`, `verifyBuyer`, the POST to `/api/billing/card`, and `onComplete` stay exactly as they are. Only the JSX and the `Props` type change.

**Files:**
- Modify: `components/billing/SquareCardForm.tsx`

- [x] **Step 1: Replace the imports and `Props`**

At the top of `components/billing/SquareCardForm.tsx`, change the React import line and add three component imports:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../Button";
import Field from "../Field";
import MessageBanner from "../MessageBanner";
```

Replace the `Props` type:

```tsx
type Props = {
  onComplete: (response: Record<string, unknown>) => void;
  /** Defaults to the first-time wording. Pass "Save new card" when replacing. */
  submitLabel?: string;
  /** When given, a Cancel button renders beside the submit. */
  onCancel?: () => void;
};
```

And the function signature:

```tsx
export default function SquareCardForm({
  onComplete,
  submitLabel = "Save card and start subscription",
  onCancel,
}: Props) {
```

- [x] **Step 2: Replace the returned JSX**

Replace everything from `return (` to the end of the component with:

```tsx
  return (
    <div className="grid gap-3">
      <Field
        id="cc-name"
        label="Name on card"
        type="text"
        value={cardholderName}
        onChange={(e) => setCardholderName(e.target.value)}
        autoComplete="cc-name"
      />

      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-2">Card details</span>
        {/* The Square SDK attaches its iframe by this selector (see init()
            above), so the id is load-bearing. border-ink-3 matches Field's
            input border for the reason documented in components/Field.tsx. */}
        <div
          id="square-card-container"
          className="rounded-md border border-ink-3 bg-surface p-2"
        />
      </div>

      <MessageBanner tone="danger">{errorMessage}</MessageBanner>

      <div className="flex flex-wrap gap-2">
        {/* Label is constant while submitting: Button documents that swapping
            the children mid-submit shrinks the control. loading covers
            aria-busy and the wait cursor; submit() already guards re-entry. */}
        <Button onClick={submit} disabled={!ready} loading={submitting}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors. (`Field` accepts arbitrary input attributes, `Button` defaults `type="button"`.)

- [x] **Step 4: Commit**

```bash
git add components/billing/SquareCardForm.tsx
git commit -F - <<'EOF'
refactor(billing): restyle SquareCardForm with Field, Button and MessageBanner

Adds optional submitLabel and onCancel props so the replace-card flow can
say "Save new card" and back out. SDK, tokenise, 3DS and POST logic are
unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 5: `NextInvoiceCard`

A loading-aware card, per the skeletons spec: one component, `loading` prop, labels render real, only the data-bearing values become skeletons.

**Files:**
- Create: `app/settings/billing/NextInvoiceCard.tsx`

- [x] **Step 1: Create the component**

```tsx
import type { ReactNode } from "react";
import Card from "../../../components/Card";
import Skeleton from "../../../components/Skeleton";
import { cn } from "../../../lib/cn";
import { formatCycleDate } from "../../../lib/billing/format";
import {
  formatPence,
  NET_PENCE_PER_VEHICLE,
  type ChargeAmounts,
} from "../../../lib/billing/money";

type Props = {
  loading: boolean;
  amounts: ChargeAmounts;
  /** company_billing.next_charge_on, or null when no card is on file. */
  nextChargeOn: string | null;
};

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-1.5 text-sm",
        strong ? "font-semibold text-ink" : "text-ink-2"
      )}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums slashed-zero text-ink">{value}</span>
    </div>
  );
}

export default function NextInvoiceCard({ loading, amounts, nextChargeOn }: Props) {
  // Skeleton widths are in ch so they roughly match the digits they stand in for.
  const money = (pence: number, w: string): ReactNode =>
    loading ? <Skeleton display="inline-block" w={w} h="0.875rem" /> : formatPence(pence);

  const vehiclesLabel = loading
    ? `Licensed vehicles × ${formatPence(NET_PENCE_PER_VEHICLE)}`
    : `${amounts.vehicleCount} ${amounts.vehicleCount === 1 ? "vehicle" : "vehicles"} × ${formatPence(NET_PENCE_PER_VEHICLE)}`;

  return (
    <Card kicker="Next invoice">
      <Row label={vehiclesLabel} value={money(amounts.netPence, "6ch")} />
      <Row label={`VAT at ${amounts.vatRate}%`} value={money(amounts.vatPence, "5ch")} />
      <div className="my-1 border-t border-line" />
      <Row label="Total" value={money(amounts.grossPence, "6ch")} strong />

      <p className="mb-1 mt-3 text-sm text-ink-3">
        {loading ? (
          <Skeleton display="inline-block" w="16ch" h="0.875rem" />
        ) : nextChargeOn ? (
          `Charged on ${formatCycleDate(nextChargeOn)}`
        ) : (
          "Charged when you add a card"
        )}
      </p>
      <p className="m-0 text-xs text-ink-3">
        The vehicle count is taken on the billing date, so this can change before then.
      </p>
    </Card>
  );
}
```

Note: the spec listed a `status` prop on this card. It is omitted here because nothing in the card branches on it (the footer depends only on `nextChargeOn`, which still holds the retry date when past due). YAGNI.

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. The component is not imported anywhere yet, which is fine.

- [x] **Step 3: Commit**

```bash
git add app/settings/billing/NextInvoiceCard.tsx
git commit -F - <<'EOF'
feat(billing): add NextInvoiceCard with net, VAT and total breakdown

Loading-aware: labels render real, values become skeletons.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 6: `PaymentMethodCard`

Owns the five display states from the spec (loading, load error, card on file, first-time setup, replacing) and exports the `BillingRow` type the page needs.

**Files:**
- Create: `app/settings/billing/PaymentMethodCard.tsx`

- [x] **Step 1: Create the component**

```tsx
"use client";

import type { ReactNode } from "react";
import { CreditCard } from "lucide-react";
import Badge from "../../../components/Badge";
import Button from "../../../components/Button";
import Card from "../../../components/Card";
import Skeleton from "../../../components/Skeleton";
import SquareCardForm from "../../../components/billing/SquareCardForm";
import type { BillingStatus } from "../../../lib/billing/format";

export type BillingRow = {
  company_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: BillingStatus;
  next_charge_on: string;
};

type Props = {
  loading: boolean;
  billing: BillingRow | null;
  /** True when the page's load failed; card management is then withheld. */
  loadError: boolean;
  /** True while the admin is replacing an existing card. */
  showForm: boolean;
  onReplace: () => void;
  onCancel: () => void;
  onComplete: (response: Record<string, unknown>) => void;
};

/* The icon square from the Settings launcher cards (app/settings/page.tsx),
   so the card reads as part of the same family. */
function IconTile() {
  return (
    <div
      aria-hidden
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary-tint text-primary-deep"
    >
      <CreditCard size={18} />
    </div>
  );
}

function expiryLabel(billing: BillingRow): string {
  if (!billing.card_exp_month || !billing.card_exp_year) return "Expiry unknown";
  return `Expires ${String(billing.card_exp_month).padStart(2, "0")}/${billing.card_exp_year}`;
}

export default function PaymentMethodCard({
  loading,
  billing,
  loadError,
  showForm,
  onReplace,
  onCancel,
  onComplete,
}: Props) {
  let body: ReactNode;

  if (loading) {
    /* Fixed-size control rendered real but disabled, data-bearing text as
       skeleton bars: the "only data-bearing leaves" rule from the skeletons
       spec. */
    body = (
      <div className="flex items-center gap-3">
        <IconTile />
        <div className="grid flex-1 gap-1.5">
          <Skeleton w="60%" h="0.875rem" />
          <Skeleton w="40%" h="0.75rem" />
        </div>
        <Button variant="secondary" size="sm" disabled>
          Replace card
        </Button>
      </div>
    );
  } else if (loadError) {
    body = (
      <p className="m-0 text-sm text-ink-3">
        Card management is unavailable until billing data loads successfully.
      </p>
    );
  } else if (billing && !showForm) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <IconTile />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            <span>
              {billing.card_brand ?? "Card"} ending {billing.card_last4 ?? "----"}
            </span>
            {billing.status === "past_due" ? (
              <Badge tone="danger">Payment failed</Badge>
            ) : null}
          </div>
          <div className="text-xs text-ink-3">{expiryLabel(billing)}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={onReplace}>
          Replace card
        </Button>
      </div>
    );
  } else if (!billing) {
    body = (
      <div className="grid gap-3">
        <p className="m-0 text-sm text-ink-2">
          Add a card to start your subscription. Your first charge is taken today.
        </p>
        <SquareCardForm onComplete={onComplete} />
      </div>
    );
  } else {
    body = (
      <SquareCardForm
        onComplete={onComplete}
        submitLabel="Save new card"
        onCancel={onCancel}
      />
    );
  }

  return <Card kicker="Payment method">{body}</Card>;
}
```

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [x] **Step 3: Commit**

```bash
git add app/settings/billing/PaymentMethodCard.tsx
git commit -F - <<'EOF'
feat(billing): add PaymentMethodCard with card-on-file, setup and replace states

Loading-aware, with a Cancel path out of the replace form that did not
exist before.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 7: Rewrite `app/settings/billing/page.tsx` and commit the allowlist entry

**Files:**
- Rewrite: `app/settings/billing/page.tsx`
- Commit (from Task 3): `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

- [x] **Step 1: Replace the whole file**

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import Badge from "../../../components/Badge";
import DataTable, {
  type Column,
  type DataTableState,
} from "../../../components/DataTable";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { billingStatusBadge, formatCycleDate } from "../../../lib/billing/format";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";
import NextInvoiceCard from "./NextInvoiceCard";
import PaymentMethodCard, { type BillingRow } from "./PaymentMethodCard";

type ChargeRow = {
  id: string;
  cycle_date: string;
  attempt: number;
  vehicle_count: number;
  gross_pence: number;
  status: "succeeded" | "failed";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

/* No widths: DataTable's comment says set them on every column or none. */
const CHARGE_COLUMNS: Column<ChargeRow>[] = [
  {
    header: "Billing date",
    cell: (c) => <span className="font-mono">{formatCycleDate(c.cycle_date)}</span>,
  },
  { header: "Attempt", cell: (c) => String(c.attempt) },
  { header: "Vehicles", align: "right", cell: (c) => String(c.vehicle_count) },
  {
    header: "Amount",
    align: "right",
    cell: (c) => (
      <span className="font-mono tabular-nums">{formatPence(c.gross_pence)}</span>
    ),
  },
  {
    header: "Status",
    cell: (c) =>
      c.status === "succeeded" ? (
        <Badge tone="success">Paid</Badge>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Badge tone="danger">Failed</Badge>
          <span className="text-xs text-ink-3">{c.failure_code ?? "declined"}</span>
        </span>
      ),
  },
  {
    header: "Receipt",
    cell: (c) =>
      c.receipt_url ? (
        <a
          href={c.receipt_url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          View
        </a>
      ) : (
        "-"
      ),
  },
];

/* Shell shared by every branch (admin, non-admin, super-admin), so the header
   never disappears and the role notices sit where the page body would. */
function PageFrame({ children }: { children: ReactNode }) {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Billing
            </h1>
            <p className="m-0 text-sm text-ink-3">
              £10 per active licensed vehicle per month, plus VAT, charged to
              your card on your billing date.
            </p>
          </header>
          {children}
        </main>
      </div>
    </TenantGate>
  );
}

export default function BillingSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [billingRes, chargesRes, licencesRes] = await Promise.all([
        supabase.from("company_billing").select("*").maybeSingle(),
        supabase
          .from("platform_charges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(24),
        supabase.from("vehicle_licences").select("vehicle_id").eq("active", true),
      ]);
      const error = billingRes.error ?? chargesRes.error ?? licencesRes.error;
      setLoadError(error ? error.message : "");
      setBilling((billingRes.data as BillingRow | null) ?? null);
      setCharges((chargesRes.data as ChargeRow[] | null) ?? []);
      setVehicleCount(
        new Set((licencesRes.data ?? []).map((l) => l.vehicle_id)).size
      );
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    /* This page mounts during tenant resolution now that TenantGate passes
       through (lib/nav/skeletonReadyRoutes.ts). Wait for "ready" so the
       queries run under a resolved session, and only query for the one role
       that can see this page: super_admin's RLS scope returns every company's
       rows, so maybeSingle() would error and the counts would be platform-wide. */
    if (tenant.status !== "ready" || tenant.role !== "admin") return;
    void load();
  }, [load, tenant.status, tenant.role]);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
  });

  /* Role gates apply only once status is ready. Before that, role is the
     provider's placeholder and every admin would see the staff notice flash. */
  if (tenant.status === "ready" && tenant.role === "super_admin") {
    return (
      <PageFrame>
        <MessageBanner tone="info">
          Platform billing for all companies lives in the super-admin console.{" "}
          <Link href="/super-admin/billing" className="underline">
            Go to super-admin billing
          </Link>
        </MessageBanner>
      </PageFrame>
    );
  }

  if (tenant.status === "ready" && tenant.role !== "admin") {
    return (
      <PageFrame>
        <MessageBanner tone="info">Billing is managed by your company admin.</MessageBanner>
      </PageFrame>
    );
  }

  const amounts = computeChargeAmounts(vehicleCount);
  const statusBadge = billingStatusBadge(billing?.status ?? null);
  const tableState: DataTableState = showSkeleton
    ? "loading"
    : loadError
      ? "error"
      : charges.length === 0
        ? "empty"
        : "ready";

  return (
    <PageFrame>
      <div aria-busy={showSkeleton || undefined}>
        {/* One announcement for the region, not one per skeleton bar. */}
        {showSkeleton ? (
          <span className="sr-only" role="status">
            Loading billing
          </span>
        ) : null}

        {/* All three banners stay mounted; MessageBanner renders sr-only when
            empty, which is what keeps its live region announcing. */}
        <MessageBanner tone="danger">
          {loadError ? `Could not load billing data: ${loadError}` : ""}
        </MessageBanner>
        <MessageBanner tone="danger">
          {billing?.status === "past_due"
            ? "Your last payment failed. Replace your card below to bring your subscription back up to date."
            : ""}
        </MessageBanner>
        <MessageBanner tone="success">{notice}</MessageBanner>

        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Licensed vehicles"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
              ) : (
                String(vehicleCount)
              )
            }
            sub={showSkeleton ? undefined : "counted on each billing date"}
          />
          <Stat
            label="Monthly total"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="6ch" h="1.25rem" />
              ) : (
                formatPence(amounts.grossPence)
              )
            }
            sub={
              showSkeleton
                ? undefined
                : `${formatPence(amounts.netPence)} + ${formatPence(amounts.vatPence)} VAT`
            }
          />
          <Stat
            label="Status"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" pill w="5ch" h="1.25rem" />
              ) : (
                /* font-sans: Stat's value span is font-mono, and a Badge
                   inside it would inherit the mono face. */
                <span className="font-sans">
                  <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
                </span>
              )
            }
          />
          <Stat
            label="Next charge"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="8ch" h="1.25rem" />
              ) : billing?.next_charge_on ? (
                formatCycleDate(billing.next_charge_on)
              ) : (
                "-"
              )
            }
          />
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <PaymentMethodCard
            loading={showSkeleton}
            billing={billing}
            loadError={Boolean(loadError)}
            showForm={showCardForm}
            onReplace={() => setShowCardForm(true)}
            onCancel={() => setShowCardForm(false)}
            onComplete={(response) => {
              setShowCardForm(false);
              setNotice(
                response.firstCharge
                  ? `Subscription started: ${formatPence(Number(response.grossPence))} charged. Next charge ${formatCycleDate(String(response.nextChargeOn))}.`
                  : "Card updated."
              );
              void load();
            }}
          />
          <NextInvoiceCard
            loading={showSkeleton}
            amounts={amounts}
            nextChargeOn={billing?.next_charge_on ?? null}
          />
        </div>

        <h2 className="mb-2 mt-0 text-base font-semibold text-ink">Charge history</h2>
        <DataTable
          columns={CHARGE_COLUMNS}
          rows={charges}
          rowKey={(c) => c.id}
          state={tableState}
          errorMessage="Couldn't load charge history."
          onRetry={load}
          emptyTitle="No charges yet"
          emptyDescription="Your first charge appears here after your billing date."
        />
      </div>
    </PageFrame>
  );
}
```

- [x] **Step 2: Typecheck and run the full test suite**

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm test`
Expected: all test files pass, including `lib/billing/money.test.ts`, `lib/billing/format.test.ts`, `lib/nav/skeletonReadyRoutes.test.ts`, and `lib/theme/contrast.test.ts` (no tokens were changed, so it must still pass unchanged).

- [x] **Step 3: Commit page and allowlist together**

```bash
git add app/settings/billing/page.tsx lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -F - <<'EOF'
feat(billing): restyle the billing page onto shared components with real loading

Layout B: stat row, payment method beside a next-invoice breakdown, then
a DataTable for charge history with loading, error and empty states.
Status is a Badge, dates are dd/mm/yyyy, banners are MessageBanners, and
the page joins SKELETON_READY_ROUTES so the £0.00 flash is gone. Role
gates now wait for tenant status to be ready, and the loader only runs
for admins. Title is "Billing" to match the launcher and sidebar.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DRihEpTuncaXU6adJfsW6G
EOF
```

---

### Task 8: Verification pass

**Files:** none changed unless a check fails.

- [x] **Step 1: Confirm no em-dashes crept in**

Run: `git diff main --name-only | xargs grep -n $'\xe2\x80\x94' ; echo "exit: $?"`
Expected: no lines printed, `exit: 1` (grep found nothing). If any line prints, replace the character and amend into a new commit.

- [x] **Step 2: Confirm the page has no leftover raw `<table>` or hand-rolled banner**

Run: `grep -nE "<table|border-danger px-4|Loading\.\.\." app/settings/billing/page.tsx ; echo "exit: $?"`
Expected: `exit: 1`.

- [x] **Step 3: Run the dev server and do the signed-in pass**

Run: `npm run dev`, then sign in as a company admin (`scripts/dev-login.mjs` if needed; note `.env.local` points at the live Supabase, so do not add a real card outside the Square sandbox).

Check, in both themes (toggle in the AppShell header):

1. First paint shows the header, four skeleton tiles, two cards with skeleton lines, and five skeleton table rows. No "0" or "£0.00" appears at any point.
2. After load: Status badge tone matches the row (Active green, Past due red, Not set up grey); Next charge is `dd/mm/yyyy`.
3. Payment method shows the card icon tile, "Visa ending 1111" style line, expiry in muted text, and a "Replace card" button. Clicking it swaps in the form with "Save new card" and a "Cancel" that returns to the summary.
4. Next invoice rows add up (net + VAT = total) and the footer date matches the Next charge tile.
5. Charge history has a tinted uppercase header row; failed rows show a red "Failed" badge with the code beside it; receipts open in a new tab.
6. With no charges (a fresh sandbox company), the table shows "No charges yet" and its description, not an empty grid.
7. Signed in as staff: header plus the info banner only. Signed in as super_admin: header plus the info banner with a working link.

- [x] **Step 4: Record the result**

If everything above holds, the branch is ready for the finishing-a-development-branch step (merge to main, push). If anything fails, fix it in a follow-up commit on this branch and re-run Steps 1 to 3.
