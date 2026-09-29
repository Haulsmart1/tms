# Driver Shifts and DVSA Walkaround Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Own-fleet drivers start and end shifts on their phone, must pass a DVSA-style walkaround check before working, defects feed `/maintenance` with automatic VOR for dangerous ones, and the office sees it all on `/dashboard`, `/shifts` and `/maintenance`.

**Architecture:** Pure rules live in `lib/walkaround/`, `lib/shifts/`, `lib/offline/` and `lib/dashboard/fleetReadiness.ts`, each unit-tested. New tables are read-only from the browser (RLS SELECT only, DML revoked); every write goes through a route handler that authorizes and then calls a SECURITY DEFINER RPC so multi-row writes are atomic and idempotent on a phone-generated `client_id`. The driver app keeps an ordered IndexedDB queue so everything works offline.

**Tech Stack:** Next.js 16 App Router route handlers, React 19, TypeScript, Supabase (Postgres RLS, plpgsql RPCs, Storage), zod 4, vitest (TZ pinned to Europe/London), `qrcode` (new dependency, QR rendering only), `@zxing/browser` (already installed, QR scanning).

**Spec:** `docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md`. Read it before starting any task.

**Project rules every task must follow** (from `CLAUDE.md`; read it once before Task 1):
- No em-dashes anywhere: code comments, docs, UI copy, commit messages.
- Tests are colocated `lib/**/x.test.ts`; only `lib/` runs under vitest. `npm test` runs all; `npx vitest run <file>` runs one.
- `npm run typecheck` must pass before every commit.
- Never import `lib/supabase/admin.ts` or anything using `node:crypto` from client code.
- Never use Tailwind `dark:` variants. Console pages use `className="ds font-sans bg-canvas text-ink"` on the root.
- Every new page or route handler must be listed in `lib/auth/routeClassification.test.ts` (protected list). Every new console page must be listed in `lib/nav/themeableRoutes.ts` and its test.
- Copy must never imply a legal hours check: shift hours are "recorded hours", warnings are factual ("on duty over 13h").
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Spec clarifications decided while planning** (the spec is updated in Task 25):
1. `phase` lives on `walkaround_checks` (`start` | `swap` | `end_of_shift`), not on defects. End-of-shift defects are recorded as an `end_of_shift` check whose snapshot holds only the reported items.
2. The QR payload is short: `TMSW1:<16-char Crockford base32 token>`. The server finds the vehicle by the token's SHA-256 hash within the driver's tenant.
3. Rectification is a database trigger: when a `maintenance_records` row linked to a defect becomes `completed`, the defect's `rectified_at` is set. The `/maintenance` page needs no new write path for this.
4. An office-started shift (driver's phone unavailable) records hours only: it has no vehicle period, so the job gate still blocks stop completion.

---

## File map

**Pure logic (vitest):**
- `lib/walkaround/types.ts`: shared types (Severity, CatalogueItem, CheckResult, ...).
- `lib/walkaround/baseline.ts`: the locked DVSA-based baseline catalogue data.
- `lib/walkaround/catalogue.ts`: active catalogue for a company, grouping, snapshot, company-item validation.
- `lib/walkaround/severity.ts`: resolve each defect's final severity, check result, "why dangerous" text.
- `lib/walkaround/vor.ts`: return-to-service rule, VOR reason text, WLK01 error recognition.
- `lib/walkaround/jobGate.ts`: may this driver complete stops.
- `lib/walkaround/qrToken.ts`: QR payload encode/parse, registration normalising (client-safe).
- `lib/walkaround/qrTokenServer.ts`: token generation and hashing (server-only, `node:crypto`).
- `lib/walkaround/liability.ts`: versioned liability notice.
- `lib/shifts/hours.ts`: duty/break/worked minutes, mileage, flags, break validation.
- `lib/shifts/syncRules.ts`: occurrence-time sanity flags, correction precedence.
- `lib/shifts/events.ts`: zod schema for queued driver events.
- `lib/shifts/csv.ts`: shift history CSV.
- `lib/offline/queue.ts`: ordered retry queue state machine.
- `lib/dashboard/fleetReadiness.ts`: dashboard tiles, attention items, "Fleet today" rows.

**SQL (hand-applied):**
- `docs/sql/shifts_01_tables.sql`, `shifts_02_catalogue_seed.sql`, `shifts_03_triggers.sql`, `shifts_04_rpcs.sql`, `shifts_05_storage.sql`, `shifts_verify.sql`; `docs/sql/prodfix_00_APPLY_ORDER.md` updated.

**Server:**
- `lib/walkaround/server.ts`: loaders and RPC wrappers (server-only).
- `app/api/driver/shift/route.ts` (GET state), `app/api/driver/shift/events/route.ts` (POST one queued event),
  `app/api/driver/walkaround/photos/upload-url/route.ts`, `app/api/driver/walkaround/photos/route.ts`.
- `app/api/shifts/route.ts` (GET fleet today + history, POST office start), `app/api/shifts/[id]/corrections/route.ts`.
- `app/api/walkaround/checks/route.ts`, `app/api/walkaround/checks/[id]/route.ts`,
  `app/api/walkaround/objections/[id]/route.ts`.
- `app/api/settings/walkaround/route.ts`, `app/api/settings/walkaround/items/[id]/route.ts`.
- `app/api/vehicles/[id]/walkaround-qr/route.ts`.
- Modified: the two driver stop routes (`complete`, `evidence`) gain the job gate.

**UI:**
- `lib/offline/idbStore.ts` (thin IndexedDB adapter, client), `app/driver/useDriverQueue.ts` (hook).
- `app/driver/dashboard/ShiftPanel.tsx`, modified `app/driver/dashboard/page.tsx`.
- `app/driver/walkaround/page.tsx` and `app/driver/walkaround/*` components (fixed light palette, like `/driver/jobs/[jobId]`).
- `app/shifts/page.tsx`, `app/maintenance/WalkaroundChecksTab.tsx` + modified `app/maintenance/page.tsx`,
  `app/settings/walkaround/page.tsx`, `app/vehicles/WalkaroundQrButton.tsx` + modified `app/vehicles/page.tsx`,
  modified `app/dashboard/page.tsx`, nav link additions.

---

## Phase A: pure logic

### Task 1: Types, baseline catalogue and catalogue helpers

**Files:**
- Create: `lib/walkaround/types.ts`, `lib/walkaround/baseline.ts`, `lib/walkaround/catalogue.ts`
- Test: `lib/walkaround/catalogue.test.ts`, `lib/walkaround/baseline.test.ts`

- [ ] **Step 1: Write `lib/walkaround/types.ts`** (types only, no test needed)

```ts
/*
  Shared types for driver walkaround checks. Pure and client-safe.
  Spec: docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md
*/

export type Severity = "minor" | "dangerous";
export type AppliesTo = "vehicle" | "trailer" | "both";
export type CheckResult = "pass" | "minor" | "dangerous";
export type SeveritySource = "baseline" | "company" | "driver";
export type CheckPhase = "start" | "swap" | "end_of_shift";
export type ObjectionStatus = "pending" | "approved" | "rejected";

/** One row of defect_catalogue_items. companyId null = locked baseline. */
export type CatalogueItem = {
  id: string;
  companyId: string | null;
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
  sortOrder: number;
  retiredAt: string | null;
};
```

- [ ] **Step 2: Write the failing baseline test** `lib/walkaround/baseline.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BASELINE_CATALOGUE } from "./baseline";

describe("BASELINE_CATALOGUE", () => {
  it("has unique codes in the dotted lower-case form", () => {
    const codes = BASELINE_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
  });

  it("never uses the company prefix reserved for company items", () => {
    for (const e of BASELINE_CATALOGUE) expect(e.code.startsWith("co.")).toBe(false);
  });

  it("classes the core roadworthiness defects as dangerous", () => {
    const dangerous = new Set(BASELINE_CATALOGUE.filter((e) => e.severity === "dangerous").map((e) => e.code));
    for (const code of [
      "brakes.air_leak",
      "brakes.pressure_build",
      "steering.excessive_play",
      "tyres.tread",
      "wheels.nut_loose",
      "leaks.fuel",
      "lights.brake_lamp",
      "coupling.insecure",
      "load.insecure",
      "mirrors_glass.windscreen_view",
    ]) {
      expect(dangerous.has(code), code).toBe(true);
    }
  });

  it("gives every entry guidance and ascending sort order", () => {
    let last = -1;
    for (const e of BASELINE_CATALOGUE) {
      expect(e.guidance.length).toBeGreaterThan(10);
      expect(e.sortOrder).toBeGreaterThan(last);
      last = e.sortOrder;
    }
  });

  it("contains no em-dashes", () => {
    expect(JSON.stringify(BASELINE_CATALOGUE)).not.toContain("\u2014");
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/baseline.test.ts`
Expected: FAIL, cannot resolve `./baseline`.

- [ ] **Step 4: Write `lib/walkaround/baseline.ts`**

```ts
/*
  The locked baseline walkaround catalogue: the checks every HGV needs, based on
  the DVSA guide to the daily walkaround check. DVSA-based, not DVSA-endorsed:
  never describe it as approved.

  THE CONTRACT with docs/sql/shifts_02_catalogue_seed.sql: every entry here is
  seeded there with the same code and severity, and
  lib/walkaround/baselineSql.test.ts fails when they drift. Companies cannot
  edit, retire or downgrade these rows (trigger in shifts_03).
*/

import type { AppliesTo, Severity } from "./types";

export type BaselineEntry = {
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
  sortOrder: number;
};

type Row = [code: string, category: string, itemLabel: string, defectLabel: string, severity: Severity, appliesTo: AppliesTo, guidance: string];

const ROWS: Row[] = [
  ["mirrors_glass.mirror_missing_broken", "mirrors_glass", "Mirrors and glass", "Mirror missing, broken or cannot be adjusted", "dangerous", "vehicle", "Check every mirror is present, secure, unbroken and gives a clear view."],
  ["mirrors_glass.windscreen_view", "mirrors_glass", "Mirrors and glass", "Windscreen damage in the driver's line of sight", "dangerous", "vehicle", "Look for cracks, chips or discolouration in the area swept by the wipers."],
  ["mirrors_glass.windscreen_other", "mirrors_glass", "Mirrors and glass", "Windscreen or window damage outside the driver's line of sight", "minor", "vehicle", "Report any other crack or chip so it can be repaired before it spreads."],
  ["wipers.inoperative", "wipers_washers", "Wipers and washers", "Wipers do not work or blades are missing or worn", "dangerous", "vehicle", "Operate the wipers and washers; the blades must clear the screen."],
  ["wipers.washer_empty", "wipers_washers", "Wipers and washers", "Washer fluid empty or washers do not spray", "minor", "vehicle", "Operate the washers and top up the fluid if needed."],
  ["front_view.obstructed", "front_view", "Front view", "Driver's view obstructed by stickers or objects", "minor", "vehicle", "Nothing should block the view through the windscreen in the area swept by the wipers."],
  ["dashboard.brake_warning", "dashboard", "Dashboard warning lights and gauges", "Brake, ABS or EBS warning light stays on", "dangerous", "vehicle", "Switch on the ignition; every warning light must go out after the self-test."],
  ["dashboard.other_warning", "dashboard", "Dashboard warning lights and gauges", "Other warning light stays on or a gauge does not work", "minor", "vehicle", "Note which warning light or gauge is affected."],
  ["steering.excessive_play", "steering", "Steering", "Excessive play, stiffness or noise in the steering", "dangerous", "vehicle", "With the engine running, turn the wheel; there must be no excessive free play or jamming."],
  ["horn.inoperative", "horn", "Horn", "Horn does not work", "minor", "vehicle", "Sound the horn; it must work and be within reach."],
  ["brakes.air_leak", "brakes_air", "Brakes and air build-up", "Audible air leak", "dangerous", "both", "Listen for air leaks with the system charged; pressure must build and hold."],
  ["brakes.pressure_build", "brakes_air", "Brakes and air build-up", "Air pressure does not build or the warning buzzer stays on", "dangerous", "vehicle", "Watch the gauges while the system charges; the warning must clear."],
  ["brakes.parking_brake", "brakes_air", "Brakes and air build-up", "Parking brake does not hold", "dangerous", "both", "Apply the parking brake and check the vehicle does not creep."],
  ["height_marker.missing_wrong", "height_marker", "Height marker", "Height marker missing or showing the wrong height", "minor", "vehicle", "The cab height indicator must show the current running height."],
  ["seatbelts.faulty", "seatbelts", "Seatbelts", "Seatbelt cut, frayed, or does not latch or retract", "dangerous", "vehicle", "Every seatbelt must be undamaged and latch and retract properly."],
  ["lights.headlamp", "lights", "Lights and indicators", "Headlamp or sidelamp not working", "dangerous", "vehicle", "Walk round with the lamps on; every lamp must work, show the right colour and have an intact lens."],
  ["lights.brake_lamp", "lights", "Lights and indicators", "Brake light not working", "dangerous", "both", "Use a reflection or a colleague to check the brake lights."],
  ["lights.indicator", "lights", "Lights and indicators", "Indicator or hazard light not working", "dangerous", "both", "Switch on the hazard lights and check every indicator flashes."],
  ["lights.lens_damaged", "lights", "Lights and indicators", "Lamp lens cracked or missing, lamp still works", "minor", "both", "Report any damaged lens so it can be replaced."],
  ["leaks.fuel", "fuel_oil_leaks", "Fuel and oil leaks", "Fuel leak", "dangerous", "vehicle", "Look under the vehicle and around the tanks with the engine running."],
  ["leaks.fuel_cap", "fuel_oil_leaks", "Fuel and oil leaks", "Fuel cap missing or not secure", "dangerous", "vehicle", "Every fuel cap must be present and sealed."],
  ["leaks.oil", "fuel_oil_leaks", "Fuel and oil leaks", "Oil or other fluid dripping onto the road", "dangerous", "both", "Look under the engine, gearbox and axles for drips."],
  ["battery.insecure", "battery", "Battery security and condition", "Battery insecure or leaking", "minor", "vehicle", "The battery must be held down and show no leaks."],
  ["adblue.low", "adblue", "Diesel exhaust fluid (AdBlue)", "AdBlue low or warning light on", "minor", "vehicle", "Check the AdBlue level and top up if needed."],
  ["exhaust.smoke", "exhaust", "Excessive engine exhaust smoke", "Excessive smoke from the exhaust", "minor", "vehicle", "With the engine running, check the exhaust does not give off excessive smoke."],
  ["body.insecure", "body_wings", "Security of body and wings", "Body panel, wing or fitting loose and likely to fall", "dangerous", "both", "Check doors, panels, wings and fittings are secure."],
  ["spray.missing", "spray_suppression", "Spray suppression", "Spray suppression flap or mudguard missing or damaged", "minor", "both", "Every wheel must have its mudguard and spray suppression fitted and secure."],
  ["tyres.tread", "tyres_wheels", "Tyres and wheel fixing", "Tread below 1mm or cords visible", "dangerous", "both", "Check every tyre, including inner twins, for tread depth and exposed cords."],
  ["tyres.damage", "tyres_wheels", "Tyres and wheel fixing", "Cut, bulge or damage to a tyre", "dangerous", "both", "Look at both sidewalls of every tyre for cuts, bulges and damage."],
  ["tyres.underinflated", "tyres_wheels", "Tyres and wheel fixing", "Tyre flat or visibly under-inflated", "dangerous", "both", "Every tyre must be visibly inflated; report any that look low."],
  ["wheels.nut_loose", "tyres_wheels", "Tyres and wheel fixing", "Wheel nut missing or loose, or indicator moved", "dangerous", "both", "Check every wheel nut is present and any wheel nut indicators line up."],
  ["brake_lines.damaged", "brake_lines", "Brake lines", "Brake line or air hose damaged, chafed or leaking", "dangerous", "both", "Check the air lines and brake hoses for damage and chafing."],
  ["electrical.connections", "electrical", "Electrical connections", "Trailer electrical connection damaged or insecure", "dangerous", "both", "Every electrical line must be connected, undamaged and not chafing."],
  ["coupling.insecure", "coupling", "Coupling security", "Fifth wheel or drawbar coupling not locked or secured", "dangerous", "both", "Check the fifth wheel jaw is locked, the safety catch is on and the landing legs are raised."],
  ["load.insecure", "load", "Security of load", "Load not secured or at risk of shifting", "dangerous", "both", "Check straps, chains, curtains and doors hold the load securely."],
  ["number_plate.illegible", "number_plate", "Number plate", "Number plate missing, dirty or illegible", "minor", "both", "Every number plate must be present, clean and readable."],
  ["reflectors.missing", "reflectors", "Reflectors", "Reflector missing, broken or dirty", "minor", "both", "Check the side and rear reflectors are present, clean and unbroken."],
  ["markings.missing", "markings", "Markings and warning plates", "Required marking or warning plate missing", "minor", "both", "Check rear markings and any hazard warning plates are fitted and correct for the load."],
];

export const BASELINE_CATALOGUE: readonly BaselineEntry[] = ROWS.map(
  ([code, category, itemLabel, defectLabel, severity, appliesTo, guidance], index) => ({
    code,
    category,
    itemLabel,
    defectLabel,
    guidance,
    severity,
    appliesTo,
    sortOrder: (index + 1) * 10,
  }),
);
```

- [ ] **Step 5: Run the baseline test, confirm it passes**

Run: `npx vitest run lib/walkaround/baseline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing catalogue test** `lib/walkaround/catalogue.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { activeCatalogue, groupByItem, toSnapshot, validateCompanyItem } from "./catalogue";
import type { CatalogueItem } from "./types";

function item(over: Partial<CatalogueItem>): CatalogueItem {
  return {
    id: over.id ?? "id-" + (over.code ?? "x"),
    companyId: null,
    code: "brakes.air_leak",
    category: "brakes_air",
    itemLabel: "Brakes and air build-up",
    defectLabel: "Audible air leak",
    guidance: "Listen for leaks.",
    severity: "dangerous",
    appliesTo: "both",
    sortOrder: 10,
    retiredAt: null,
    ...over,
  };
}

describe("activeCatalogue", () => {
  it("keeps baseline and this company's items, drops other companies and retired rows, baseline first", () => {
    const rows = [
      item({ id: "c1", companyId: "co-1", code: "co.tail_lift.leak", category: "tail_lift", sortOrder: 5 }),
      item({ id: "b2", code: "tyres.tread", sortOrder: 20 }),
      item({ id: "b1", code: "brakes.air_leak", sortOrder: 10 }),
      item({ id: "x", companyId: "co-2", code: "co.crane.x" }),
      item({ id: "r", companyId: "co-1", code: "co.old.y", retiredAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(activeCatalogue(rows, "co-1").map((r) => r.id)).toEqual(["b1", "b2", "c1"]);
  });
});

describe("groupByItem", () => {
  it("groups consecutive defects by category in catalogue order", () => {
    const rows = [
      item({ id: "a", category: "brakes_air", itemLabel: "Brakes" }),
      item({ id: "b", category: "brakes_air", itemLabel: "Brakes" }),
      item({ id: "c", category: "tyres_wheels", itemLabel: "Tyres" }),
    ];
    const groups = groupByItem(rows);
    expect(groups.map((g) => [g.category, g.itemLabel, g.defects.map((d) => d.id)])).toEqual([
      ["brakes_air", "Brakes", ["a", "b"]],
      ["tyres_wheels", "Tyres", ["c"]],
    ]);
  });
});

describe("toSnapshot", () => {
  it("records source and drops internal fields", () => {
    const snap = toSnapshot([item({ id: "b1" }), item({ id: "c1", companyId: "co-1", code: "co.a.b" })]);
    expect(snap[0]).toEqual({
      id: "b1",
      code: "brakes.air_leak",
      category: "brakes_air",
      itemLabel: "Brakes and air build-up",
      defectLabel: "Audible air leak",
      guidance: "Listen for leaks.",
      severity: "dangerous",
      source: "baseline",
    });
    expect(snap[1].source).toBe("company");
  });
});

describe("validateCompanyItem", () => {
  const good = {
    category: "Tail lift",
    itemLabel: "Tail-lift",
    defectLabel: "Hydraulic leak",
    guidance: "Look under the platform.",
    severity: "dangerous",
    appliesTo: "vehicle",
  };

  it("accepts a valid item and builds a co. prefixed code", () => {
    const result = validateCompanyItem(good, new Set());
    expect(result).toEqual({
      ok: true,
      value: {
        code: "co.tail_lift.hydraulic_leak",
        category: "tail_lift",
        itemLabel: "Tail-lift",
        defectLabel: "Hydraulic leak",
        guidance: "Look under the platform.",
        severity: "dangerous",
        appliesTo: "vehicle",
      },
    });
  });

  it("suffixes the code when it already exists", () => {
    const result = validateCompanyItem(good, new Set(["co.tail_lift.hydraulic_leak"]));
    expect(result.ok && result.value.code).toBe("co.tail_lift.hydraulic_leak_2");
  });

  it("refuses bad severity, missing labels and over-long text", () => {
    expect(validateCompanyItem({ ...good, severity: "critical" }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, defectLabel: "  " }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, itemLabel: "x".repeat(81) }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, guidance: "x".repeat(401) }, new Set()).ok).toBe(false);
  });

  it("defaults appliesTo to vehicle", () => {
    const result = validateCompanyItem({ ...good, appliesTo: undefined }, new Set());
    expect(result.ok && result.value.appliesTo).toBe("vehicle");
  });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/catalogue.test.ts`
Expected: FAIL, cannot resolve `./catalogue`.

- [ ] **Step 8: Write `lib/walkaround/catalogue.ts`**

```ts
/*
  The walkaround checklist a driver sees: the locked baseline plus the
  company's own active items. Pure and client-safe.
*/

import type { AppliesTo, CatalogueItem, Severity } from "./types";

export type SnapshotItem = {
  id: string;
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  source: "baseline" | "company";
};

export type ItemGroup = { category: string; itemLabel: string; defects: CatalogueItem[] };

const SEVERITIES: readonly Severity[] = ["minor", "dangerous"];
const APPLIES_TO: readonly AppliesTo[] = ["vehicle", "trailer", "both"];

/** Baseline first, then the company's items; retired and other companies' rows removed. */
export function activeCatalogue(items: readonly CatalogueItem[], companyId: string): CatalogueItem[] {
  return items
    .filter((i) => i.retiredAt === null && (i.companyId === null || i.companyId === companyId))
    .sort(
      (a, b) =>
        (a.companyId === null ? 0 : 1) - (b.companyId === null ? 0 : 1) ||
        a.sortOrder - b.sortOrder ||
        a.code.localeCompare(b.code),
    );
}

/** Consecutive rows with the same category form one checklist item. */
export function groupByItem(items: readonly CatalogueItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const row of items) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) last.defects.push(row);
    else groups.push({ category: row.category, itemLabel: row.itemLabel, defects: [row] });
  }
  return groups;
}

export function toSnapshot(items: readonly CatalogueItem[]): SnapshotItem[] {
  return items.map((i) => ({
    id: i.id,
    code: i.code,
    category: i.category,
    itemLabel: i.itemLabel,
    defectLabel: i.defectLabel,
    guidance: i.guidance,
    severity: i.severity,
    source: i.companyId === null ? "baseline" : "company",
  }));
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type CompanyItemInput = {
  category?: unknown;
  itemLabel?: unknown;
  defectLabel?: unknown;
  guidance?: unknown;
  severity?: unknown;
  appliesTo?: unknown;
};

export type ValidCompanyItem = {
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validate a company-added item. Company codes always start "co." so they never collide with the baseline. */
export function validateCompanyItem(
  input: CompanyItemInput,
  existingCodes: ReadonlySet<string>,
): { ok: true; value: ValidCompanyItem } | { ok: false; error: string } {
  const category = slug(text(input.category));
  const itemLabel = text(input.itemLabel);
  const defectLabel = text(input.defectLabel);
  const guidance = text(input.guidance);
  const appliesTo = input.appliesTo === undefined || input.appliesTo === null ? "vehicle" : input.appliesTo;

  if (!category) return { ok: false, error: "Give the item a category." };
  if (!itemLabel || itemLabel.length > 80) return { ok: false, error: "The item name must be 1 to 80 characters." };
  if (!defectLabel || defectLabel.length > 120) return { ok: false, error: "The defect must be 1 to 120 characters." };
  if (guidance.length > 400) return { ok: false, error: "Guidance must be 400 characters or fewer." };
  if (!SEVERITIES.includes(input.severity as Severity)) return { ok: false, error: "Severity must be minor or dangerous." };
  if (!APPLIES_TO.includes(appliesTo as AppliesTo)) return { ok: false, error: "Applies to must be vehicle, trailer or both." };

  const base = `co.${category}.${slug(defectLabel) || "defect"}`;
  let code = base;
  for (let n = 2; existingCodes.has(code); n += 1) code = `${base}_${n}`;

  return {
    ok: true,
    value: {
      code,
      category,
      itemLabel,
      defectLabel,
      guidance,
      severity: input.severity as Severity,
      appliesTo: appliesTo as AppliesTo,
    },
  };
}
```

- [ ] **Step 9: Run both tests, then typecheck**

Run: `npx vitest run lib/walkaround/ && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add lib/walkaround/types.ts lib/walkaround/baseline.ts lib/walkaround/baseline.test.ts lib/walkaround/catalogue.ts lib/walkaround/catalogue.test.ts
git commit -m "Add the walkaround baseline catalogue and catalogue helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Defect severity rules

**Files:**
- Create: `lib/walkaround/severity.ts`
- Test: `lib/walkaround/severity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { checkResult, dangerReason, resolveDefect } from "./severity";
import type { CatalogueItem } from "./types";

const base: CatalogueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: null,
  code: "brakes.air_leak",
  category: "brakes_air",
  itemLabel: "Brakes and air build-up",
  defectLabel: "Audible air leak",
  guidance: "Listen.",
  severity: "dangerous",
  appliesTo: "both",
  sortOrder: 10,
  retiredAt: null,
};
const minor: CatalogueItem = { ...base, id: "22222222-2222-4222-8222-222222222222", code: "horn.inoperative", itemLabel: "Horn", defectLabel: "Horn does not work", severity: "minor" };
const companyMinor: CatalogueItem = { ...minor, id: "33333333-3333-4333-8333-333333333333", companyId: "co-1", code: "co.tail_lift.slow" };
const retired: CatalogueItem = { ...minor, id: "44444444-4444-4444-8444-444444444444", retiredAt: "2026-01-01T00:00:00Z" };
const catalogue = new Map([base, minor, companyMinor, retired].map((i) => [i.id, i]));

const d = (over: object) => ({ clientId: "c", catalogueItemId: base.id, driverSeverity: null, note: null, ...over });

describe("resolveDefect", () => {
  it("takes severity from the catalogue", () => {
    const r = resolveDefect(d({}), catalogue);
    expect(r).toMatchObject({ ok: true, value: { finalSeverity: "dangerous", catalogueSeverity: "dangerous", escalatedByDriver: false, severitySource: "baseline", label: "Brakes and air build-up: Audible air leak" } });
  });

  it("never lets the driver downgrade a dangerous defect", () => {
    const r = resolveDefect(d({ driverSeverity: "minor" }), catalogue);
    expect(r.ok && r.value.finalSeverity).toBe("dangerous");
  });

  it("lets the driver escalate a minor defect and records it", () => {
    const r = resolveDefect(d({ catalogueItemId: minor.id, driverSeverity: "dangerous" }), catalogue);
    expect(r).toMatchObject({ ok: true, value: { finalSeverity: "dangerous", catalogueSeverity: "minor", escalatedByDriver: true, severitySource: "driver" } });
  });

  it("marks company items as company-sourced", () => {
    const r = resolveDefect(d({ catalogueItemId: companyMinor.id }), catalogue);
    expect(r.ok && r.value.severitySource).toBe("company");
  });

  it("treats Other as minor unless the driver marks it dangerous, and needs a note", () => {
    expect(resolveDefect(d({ catalogueItemId: null, note: "  " }), catalogue).ok).toBe(false);
    const minorOther = resolveDefect(d({ catalogueItemId: null, note: "Cab step cracked" }), catalogue);
    expect(minorOther).toMatchObject({ ok: true, value: { finalSeverity: "minor", catalogueSeverity: null, severitySource: "driver", label: "Other: Cab step cracked" } });
    const dangerOther = resolveDefect(d({ catalogueItemId: null, note: "Smoke from wheel", driverSeverity: "dangerous" }), catalogue);
    expect(dangerOther.ok && dangerOther.value.finalSeverity).toBe("dangerous");
    expect(dangerOther.ok && dangerOther.value.escalatedByDriver).toBe(true);
  });

  it("refuses unknown and retired items", () => {
    expect(resolveDefect(d({ catalogueItemId: "55555555-5555-4555-8555-555555555555" }), catalogue).ok).toBe(false);
    expect(resolveDefect(d({ catalogueItemId: retired.id }), catalogue).ok).toBe(false);
  });
});

describe("checkResult", () => {
  it("is pass, minor or dangerous by the worst defect", () => {
    expect(checkResult([])).toBe("pass");
    expect(checkResult([{ finalSeverity: "minor" }])).toBe("minor");
    expect(checkResult([{ finalSeverity: "minor" }, { finalSeverity: "dangerous" }])).toBe("dangerous");
  });
});

describe("dangerReason", () => {
  it("explains where the classification came from", () => {
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "baseline" }, "Acme")).toBe("Classed dangerous in the DVSA baseline checklist.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "company" }, "Acme")).toBe("Classed dangerous by Acme for this item.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "company" }, null)).toBe("Classed dangerous by your company for this item.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "driver" }, "Acme")).toBe("You marked this as dangerous.");
    expect(dangerReason({ finalSeverity: "minor", severitySource: "baseline" }, "Acme")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/severity.test.ts`
Expected: FAIL, cannot resolve `./severity`.

- [ ] **Step 3: Write `lib/walkaround/severity.ts`**

```ts
/*
  Severity is decided by the catalogue, never by the driver. The driver can
  escalate a minor defect to dangerous but can never downgrade. The server runs
  this on every submission and ignores what the phone claims.
*/

import type { CatalogueItem, CheckResult, Severity, SeveritySource } from "./types";

export type SubmittedDefect = {
  clientId: string;
  catalogueItemId: string | null;
  driverSeverity: Severity | null;
  note: string | null;
};

export type ResolvedDefect = {
  clientId: string;
  catalogueItemId: string | null;
  label: string;
  catalogueSeverity: Severity | null;
  finalSeverity: Severity;
  escalatedByDriver: boolean;
  severitySource: SeveritySource;
  note: string | null;
};

export function resolveDefect(
  defect: SubmittedDefect,
  catalogue: ReadonlyMap<string, CatalogueItem>,
): { ok: true; value: ResolvedDefect } | { ok: false; error: string } {
  const note = defect.note?.trim() || null;

  if (defect.catalogueItemId === null) {
    if (!note) return { ok: false, error: "Describe the defect." };
    const dangerous = defect.driverSeverity === "dangerous";
    return {
      ok: true,
      value: {
        clientId: defect.clientId,
        catalogueItemId: null,
        label: `Other: ${note.slice(0, 80)}`,
        catalogueSeverity: null,
        finalSeverity: dangerous ? "dangerous" : "minor",
        escalatedByDriver: dangerous,
        severitySource: "driver",
        note,
      },
    };
  }

  const item = catalogue.get(defect.catalogueItemId);
  if (!item) return { ok: false, error: "That defect is not on this vehicle's checklist." };
  if (item.retiredAt !== null) return { ok: false, error: "That defect has been retired from the checklist." };

  const escalated = item.severity === "minor" && defect.driverSeverity === "dangerous";
  return {
    ok: true,
    value: {
      clientId: defect.clientId,
      catalogueItemId: item.id,
      label: `${item.itemLabel}: ${item.defectLabel}`,
      catalogueSeverity: item.severity,
      finalSeverity: escalated ? "dangerous" : item.severity,
      escalatedByDriver: escalated,
      severitySource: escalated ? "driver" : item.companyId === null ? "baseline" : "company",
      note,
    },
  };
}

export function checkResult(defects: readonly { finalSeverity: Severity }[]): CheckResult {
  if (defects.some((d) => d.finalSeverity === "dangerous")) return "dangerous";
  if (defects.length > 0) return "minor";
  return "pass";
}

/** The "why is this dangerous" line on the driver's VOR screen. Null for minor defects. */
export function dangerReason(
  defect: { finalSeverity: Severity; severitySource: SeveritySource },
  companyName: string | null,
): string | null {
  if (defect.finalSeverity !== "dangerous") return null;
  if (defect.severitySource === "baseline") return "Classed dangerous in the DVSA baseline checklist.";
  if (defect.severitySource === "company") return `Classed dangerous by ${companyName || "your company"} for this item.`;
  return "You marked this as dangerous.";
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/walkaround/severity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/walkaround/severity.ts lib/walkaround/severity.test.ts
git commit -m "Add walkaround defect severity rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: VOR and return-to-service rules

**Files:**
- Create: `lib/walkaround/vor.ts`
- Test: `lib/walkaround/vor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  RETURN_BLOCKED_ERRCODE,
  RETURN_BLOCKED_MESSAGE,
  blocksReturnToService,
  isReturnBlockedError,
  returnToServiceDecision,
  vorReasonForDefects,
} from "./vor";

const open = { finalSeverity: "dangerous" as const, rectifiedAt: null, objectionStatus: null };

describe("blocksReturnToService", () => {
  it("blocks only open dangerous defects without an approved objection", () => {
    expect(blocksReturnToService(open)).toBe(true);
    expect(blocksReturnToService({ ...open, finalSeverity: "minor" })).toBe(false);
    expect(blocksReturnToService({ ...open, rectifiedAt: "2026-09-29T10:00:00Z" })).toBe(false);
    expect(blocksReturnToService({ ...open, objectionStatus: "approved" })).toBe(false);
    expect(blocksReturnToService({ ...open, objectionStatus: "pending" })).toBe(true);
    expect(blocksReturnToService({ ...open, objectionStatus: "rejected" })).toBe(true);
  });
});

describe("returnToServiceDecision", () => {
  it("requires an admin", () => {
    expect(returnToServiceDecision({ tier: "staff", defects: [] })).toEqual({ ok: false, reason: "not-admin" });
    expect(returnToServiceDecision({ tier: "admin", defects: [] })).toEqual({ ok: true });
    expect(returnToServiceDecision({ tier: "super_admin", defects: [] })).toEqual({ ok: true });
  });

  it("refuses while dangerous defects are open", () => {
    expect(returnToServiceDecision({ tier: "admin", defects: [open, open, { ...open, finalSeverity: "minor" }] })).toEqual({
      ok: false,
      reason: "open-dangerous-defects",
      count: 2,
    });
  });
});

describe("vorReasonForDefects", () => {
  it("names the defects and stays within 200 characters", () => {
    expect(vorReasonForDefects(["Brakes: Audible air leak"])).toBe("Walkaround: Brakes: Audible air leak");
    expect(vorReasonForDefects(Array(20).fill("Tyres and wheel fixing: Tread below 1mm")).length).toBeLessThanOrEqual(200);
  });
});

describe("isReturnBlockedError", () => {
  it("recognises the WLK01 refusal by code or sentence", () => {
    expect(isReturnBlockedError({ code: RETURN_BLOCKED_ERRCODE })).toBe(true);
    expect(isReturnBlockedError({ message: `failed: ${RETURN_BLOCKED_MESSAGE}` })).toBe(true);
    expect(isReturnBlockedError({ code: "LIC01" })).toBe(false);
    expect(isReturnBlockedError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/vor.test.ts`
Expected: FAIL, cannot resolve `./vor`.

- [ ] **Step 3: Write `lib/walkaround/vor.ts`**

```ts
/*
  When a walkaround VOR may be lifted. Pure and client-safe.

  THE CONTRACT with docs/sql/shifts_03_triggers.sql (guard_vehicle_return_to_service):
    errcode  WLK01
    message  RETURN_BLOCKED_MESSAGE below, verbatim
  Both sides must change together.
*/

import type { RoleTier } from "../auth/tenantAccess";
import type { ObjectionStatus, Severity } from "./types";

export const RETURN_BLOCKED_ERRCODE = "WLK01";
export const RETURN_BLOCKED_MESSAGE =
  "This vehicle has an open dangerous walkaround defect. Rectify it, or approve the driver's objection, before returning the vehicle to service.";

export type DefectVorState = {
  finalSeverity: Severity;
  rectifiedAt: string | null;
  objectionStatus: ObjectionStatus | null;
};

export function blocksReturnToService(defect: DefectVorState): boolean {
  return defect.finalSeverity === "dangerous" && defect.rectifiedAt === null && defect.objectionStatus !== "approved";
}

export function returnToServiceDecision(input: {
  tier: RoleTier;
  defects: readonly DefectVorState[];
}): { ok: true } | { ok: false; reason: "not-admin" } | { ok: false; reason: "open-dangerous-defects"; count: number } {
  if (input.tier !== "admin" && input.tier !== "super_admin") return { ok: false, reason: "not-admin" };
  const count = input.defects.filter(blocksReturnToService).length;
  return count > 0 ? { ok: false, reason: "open-dangerous-defects", count } : { ok: true };
}

export function vorReasonForDefects(labels: readonly string[]): string {
  const text = `Walkaround: ${labels.join("; ")}`;
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`;
}

export function isReturnBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === RETURN_BLOCKED_ERRCODE) return true;
  return typeof e.message === "string" && e.message.includes(RETURN_BLOCKED_MESSAGE);
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/walkaround/vor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/walkaround/vor.ts lib/walkaround/vor.test.ts
git commit -m "Add walkaround VOR return-to-service rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Job gate

**Files:**
- Create: `lib/walkaround/jobGate.ts`
- Test: `lib/walkaround/jobGate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { JOB_GATE_MESSAGES, jobGateDecision } from "./jobGate";

const period = { vehicleId: "v1", checkResult: "pass" as const, vehicleVor: false };

describe("jobGateDecision", () => {
  it("never gates subcontractor drivers", () => {
    expect(jobGateDecision({ portalType: "subcontractor_driver", openShift: null })).toEqual({ ok: true });
  });

  it("needs an open shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("needs a vehicle on the shift", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: null } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("needs a pass or minor check on that vehicle", () => {
    for (const checkResult of [null, "dangerous"] as const) {
      expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult } } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
    }
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, checkResult: "minor" } } })).toEqual({ ok: true });
  });

  it("refuses when the vehicle has since gone VOR", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: { ...period, vehicleVor: true } } })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });

  it("allows a driver with a passed check on a road-worthy vehicle", () => {
    expect(jobGateDecision({ portalType: "direct_driver", openShift: { currentPeriod: period } })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/jobGate.test.ts`
Expected: FAIL, cannot resolve `./jobGate`.

- [ ] **Step 3: Write `lib/walkaround/jobGate.ts`**

```ts
/*
  May this driver complete stops and save PODs? Own-fleet drivers need an open
  shift whose current vehicle passed (or passed with minor defects) its
  walkaround and is not off the road. Subcontractor drivers run under their own
  O-licence and are not gated. Pure; lib/walkaround/server.ts loads the input.
*/

import type { DriverPortalType } from "../driver/session";
import type { CheckResult } from "./types";

export type JobGateInput = {
  portalType: DriverPortalType;
  openShift: null | {
    currentPeriod: null | { vehicleId: string; checkResult: CheckResult | null; vehicleVor: boolean };
  };
};

export const JOB_GATE_MESSAGES = {
  noShift: "Start your shift and complete a walkaround check before working on jobs.",
  noVehicle: "Complete a walkaround check on a vehicle before working on jobs.",
  noCheck: "The vehicle on your shift has not passed a walkaround check. Check a different vehicle before working on jobs.",
  vor: "The vehicle on your shift is off the road. Check a different vehicle before working on jobs.",
} as const;

export function jobGateDecision(input: JobGateInput): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.openShift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.openShift.currentPeriod;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (period.vehicleVor) return { ok: false, message: JOB_GATE_MESSAGES.vor };
  return { ok: true };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/walkaround/jobGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/walkaround/jobGate.ts lib/walkaround/jobGate.test.ts
git commit -m "Add the walkaround job gate rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: QR token and liability notice

**Files:**
- Create: `lib/walkaround/qrToken.ts`, `lib/walkaround/qrTokenServer.ts`, `lib/walkaround/liability.ts`
- Test: `lib/walkaround/qrToken.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { WALKAROUND_QR_PREFIX, encodeQrPayload, normalizeRegistration, parseQrPayload, registrationsMatch } from "./qrToken";
import { generateQrToken, hashQrToken } from "./qrTokenServer";

describe("QR payload", () => {
  it("round-trips a generated token", () => {
    const token = generateQrToken();
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(encodeQrPayload(token)).toBe(`${WALKAROUND_QR_PREFIX}${token}`);
    expect(parseQrPayload(encodeQrPayload(token))).toBe(token);
  });

  it("accepts surrounding space and a lower-case payload", () => {
    expect(parseQrPayload("  tmsw1:0123456789abcdef ")).toBe("0123456789ABCDEF");
  });

  it("rejects anything else", () => {
    expect(parseQrPayload("https://example.com")).toBeNull();
    expect(parseQrPayload("TMSW1:SHORT")).toBeNull();
    expect(parseQrPayload("TMSW1:0123456789ABCDEU")).toBeNull(); // U is not Crockford base32
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateQrToken));
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically to hex", () => {
    expect(hashQrToken("0123456789ABCDEF")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashQrToken("0123456789ABCDEF")).toBe(hashQrToken("0123456789ABCDEF"));
  });
});

describe("registrations", () => {
  it("normalises spacing and case", () => {
    expect(normalizeRegistration(" ab12 cde ")).toBe("AB12CDE");
    expect(registrationsMatch("AB12 CDE", "ab12cde")).toBe(true);
    expect(registrationsMatch("AB12 CDE", "AB12 CDF")).toBe(false);
    expect(registrationsMatch("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/qrToken.test.ts`
Expected: FAIL, cannot resolve `./qrToken`.

- [ ] **Step 3: Write `lib/walkaround/qrToken.ts`**

```ts
/*
  The cab QR code a driver scans to confirm the vehicle. Client-safe.

  A scan shows the driver was probably at the truck; it does not prove it. A
  reissued code defeats old and copied stickers, not a photo of the current one.
  Only the token's hash is stored (vehicles.walkaround_qr_token_hash).
*/

export const WALKAROUND_QR_PREFIX = "TMSW1:";
const TOKEN_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export function encodeQrPayload(token: string): string {
  return `${WALKAROUND_QR_PREFIX}${token}`;
}

export function parseQrPayload(text: string): string | null {
  const value = text.trim();
  if (value.slice(0, WALKAROUND_QR_PREFIX.length).toUpperCase() !== WALKAROUND_QR_PREFIX) return null;
  const token = value.slice(WALKAROUND_QR_PREFIX.length).toUpperCase();
  return TOKEN_RE.test(token) ? token : null;
}

export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function registrationsMatch(a: string, b: string): boolean {
  const left = normalizeRegistration(a);
  return left.length > 0 && left === normalizeRegistration(b);
}
```

- [ ] **Step 4: Write `lib/walkaround/qrTokenServer.ts`**

```ts
/*
  Server-only: QR token generation and hashing. Never import from client code
  (node:crypto). 16 Crockford base32 characters = 80 random bits.
*/

import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateQrToken(): string {
  return Array.from(randomBytes(16), (b) => ALPHABET[b & 31]).join("");
}

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 5: Write `lib/walkaround/liability.ts`**

```ts
/*
  The in-product notice an admin accepts when approving a driver's objection to
  a walkaround VOR. This is product copy, not policy wording: the matching
  clause belongs in the source Terms document in docs/TMS POLICIES/ and goes
  through solicitor review. Bump the version whenever the text changes; the
  accepted version is stored on defect_objections.liability_notice_version.
*/

export const LIABILITY_NOTICE_VERSION = "2026-09-29.1";

export const LIABILITY_NOTICE_TEXT =
  "You are overriding a defect the walkaround checklist classes as dangerous. " +
  "This override is the operator's decision and responsibility, not TMS Wizzard's. " +
  "Only approve it if you are satisfied the vehicle is roadworthy.";
```

- [ ] **Step 6: Run the test, confirm it passes, typecheck**

Run: `npx vitest run lib/walkaround/qrToken.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/walkaround/qrToken.ts lib/walkaround/qrTokenServer.ts lib/walkaround/liability.ts lib/walkaround/qrToken.test.ts
git commit -m "Add walkaround QR tokens and the liability notice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Shift hours

**Files:**
- Create: `lib/shifts/hours.ts`
- Test: `lib/shifts/hours.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { formatMinutes, summariseShift, validateBreakEnd, validateBreakStart } from "./hours";

const now = new Date("2026-09-29T18:00:00Z");

describe("summariseShift", () => {
  it("computes duty, breaks, worked and mileage for a closed shift", () => {
    const s = summariseShift(
      {
        startedAt: "2026-09-29T05:00:00Z",
        endedAt: "2026-09-29T14:12:00Z",
        breaks: [
          { startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:30:00Z" },
          { startedAt: "2026-09-29T12:00:00Z", endedAt: "2026-09-29T12:15:00Z" },
        ],
        periods: [
          { startOdometer: 1000, endOdometer: 1100 },
          { startOdometer: 5000, endOdometer: 5050 },
        ],
      },
      now,
    );
    expect(s).toEqual({ dutyMinutes: 552, breakMinutes: 45, workedMinutes: 507, mileage: 150, flags: [] });
  });

  it("uses now for an open shift and an open break", () => {
    const s = summariseShift(
      { startedAt: "2026-09-29T17:00:00Z", endedAt: null, breaks: [{ startedAt: "2026-09-29T17:40:00Z", endedAt: null }], periods: [{ startOdometer: 10, endOdometer: null }] },
      now,
    );
    expect(s).toEqual({ dutyMinutes: 60, breakMinutes: 20, workedMinutes: 40, mileage: null, flags: [] });
  });

  it("counts real elapsed time across the October clock change", () => {
    // 00:30 BST (23:30Z) to 05:30 GMT (05:30Z) is six hours, not five.
    const s = summariseShift({ startedAt: "2026-10-25T00:30:00+01:00", endedAt: "2026-10-25T05:30:00Z", breaks: [], periods: [] }, now);
    expect(s.dutyMinutes).toBe(360);
  });

  it("counts real elapsed time across the March clock change", () => {
    const s = summariseShift({ startedAt: "2026-03-29T00:30:00Z", endedAt: "2026-03-29T05:30:00+01:00", breaks: [], periods: [] }, now);
    expect(s.dutyMinutes).toBe(240);
  });

  it("flags long duty and a stale open shift", () => {
    const long = summariseShift({ startedAt: "2026-09-29T04:00:00Z", endedAt: "2026-09-29T17:30:00Z", breaks: [], periods: [] }, now);
    expect(long.flags).toEqual(["over_13h"]);
    const stale = summariseShift({ startedAt: "2026-09-28T20:00:00Z", endedAt: null, breaks: [], periods: [] }, now);
    expect(stale.flags).toEqual(["over_13h", "open_over_16h"]);
  });

  it("flags an odometer that went backwards and reports no mileage", () => {
    const s = summariseShift({ startedAt: "2026-09-29T05:00:00Z", endedAt: "2026-09-29T06:00:00Z", breaks: [], periods: [{ startOdometer: 500, endOdometer: 400 }] }, now);
    expect(s.mileage).toBeNull();
    expect(s.flags).toContain("odometer_decrease");
  });

  it("clamps a break that runs past the shift end", () => {
    const s = summariseShift(
      { startedAt: "2026-09-29T05:00:00Z", endedAt: "2026-09-29T06:00:00Z", breaks: [{ startedAt: "2026-09-29T05:30:00Z", endedAt: "2026-09-29T07:00:00Z" }], periods: [] },
      now,
    );
    expect(s.breakMinutes).toBe(30);
  });
});

describe("validateBreakStart", () => {
  const shift = { startedAt: "2026-09-29T05:00:00Z", endedAt: null, breaks: [{ startedAt: "2026-09-29T08:00:00Z", endedAt: "2026-09-29T08:30:00Z" }] };

  it("accepts a break after the last one", () => {
    expect(validateBreakStart(shift, "2026-09-29T10:00:00Z")).toEqual({ ok: true });
  });

  it("refuses before the shift, inside an earlier break, while one runs, or after the shift ended", () => {
    expect(validateBreakStart(shift, "2026-09-29T04:00:00Z").ok).toBe(false);
    expect(validateBreakStart(shift, "2026-09-29T08:10:00Z").ok).toBe(false);
    expect(validateBreakStart({ ...shift, breaks: [{ startedAt: "2026-09-29T09:00:00Z", endedAt: null }] }, "2026-09-29T10:00:00Z").ok).toBe(false);
    expect(validateBreakStart({ ...shift, endedAt: "2026-09-29T09:00:00Z" }, "2026-09-29T10:00:00Z").ok).toBe(false);
  });
});

describe("validateBreakEnd", () => {
  it("needs a running break and a later time", () => {
    expect(validateBreakEnd(null, "2026-09-29T10:00:00Z").ok).toBe(false);
    expect(validateBreakEnd({ startedAt: "2026-09-29T10:00:00Z", endedAt: null }, "2026-09-29T09:59:00Z").ok).toBe(false);
    expect(validateBreakEnd({ startedAt: "2026-09-29T10:00:00Z", endedAt: null }, "2026-09-29T10:45:00Z")).toEqual({ ok: true });
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0h 00m");
    expect(formatMinutes(552)).toBe("9h 12m");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/shifts/hours.test.ts`
Expected: FAIL, cannot resolve `./hours`.

- [ ] **Step 3: Write `lib/shifts/hours.ts`**

```ts
/*
  Recorded shift hours. These are the hours a driver logged, NOT a legal hours
  calculation: tachograph data stays the legal record, and nothing here checks
  Working Time, daily rest or weekly rest. Flags are facts ("on duty over
  13h"), never "infringement".

  All arithmetic is on instants (Date.parse), so clock-change days come out as
  real elapsed time.
*/

export type TimeInterval = { startedAt: string; endedAt: string | null };

export type ShiftForHours = {
  startedAt: string;
  endedAt: string | null;
  breaks: readonly TimeInterval[];
  periods: readonly { startOdometer: number; endOdometer: number | null }[];
};

export type ShiftFlag = "over_13h" | "open_over_16h" | "odometer_decrease";

export type ShiftSummary = {
  dutyMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  mileage: number | null;
  flags: ShiftFlag[];
};

export const LONG_DUTY_MINUTES = 13 * 60;
export const STALE_OPEN_MINUTES = 16 * 60;

function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function summariseShift(shift: ShiftForHours, now: Date): ShiftSummary {
  const start = Date.parse(shift.startedAt);
  const end = shift.endedAt ? Date.parse(shift.endedAt) : now.getTime();
  const dutyMinutes = minutesBetween(start, end);

  let breakMinutes = 0;
  for (const b of shift.breaks) {
    const bStart = Math.max(Date.parse(b.startedAt), start);
    const bEnd = Math.min(b.endedAt ? Date.parse(b.endedAt) : end, end);
    breakMinutes += minutesBetween(bStart, bEnd);
  }
  breakMinutes = Math.min(breakMinutes, dutyMinutes);

  const flags: ShiftFlag[] = [];
  if (dutyMinutes > LONG_DUTY_MINUTES) flags.push("over_13h");
  if (shift.endedAt === null && dutyMinutes > STALE_OPEN_MINUTES) flags.push("open_over_16h");

  let mileage: number | null = null;
  if (shift.periods.length > 0 && shift.periods.every((p) => p.endOdometer !== null)) {
    if (shift.periods.some((p) => (p.endOdometer as number) < p.startOdometer)) flags.push("odometer_decrease");
    else mileage = shift.periods.reduce((sum, p) => sum + ((p.endOdometer as number) - p.startOdometer), 0);
  } else if (shift.periods.some((p) => p.endOdometer !== null && p.endOdometer < p.startOdometer)) {
    flags.push("odometer_decrease");
  }

  return { dutyMinutes, breakMinutes, workedMinutes: dutyMinutes - breakMinutes, mileage, flags };
}

type Result = { ok: true } | { ok: false; error: string };

export function validateBreakStart(
  shift: { startedAt: string; endedAt: string | null; breaks: readonly TimeInterval[] },
  at: string,
): Result {
  const t = Date.parse(at);
  if (shift.endedAt !== null) return { ok: false, error: "The shift has already ended." };
  if (t < Date.parse(shift.startedAt)) return { ok: false, error: "A break cannot start before the shift." };
  if (shift.breaks.some((b) => b.endedAt === null)) return { ok: false, error: "A break is already running." };
  if (shift.breaks.some((b) => b.endedAt !== null && t >= Date.parse(b.startedAt) && t < Date.parse(b.endedAt))) {
    return { ok: false, error: "That time overlaps an earlier break." };
  }
  return { ok: true };
}

export function validateBreakEnd(openBreak: TimeInterval | null, at: string): Result {
  if (!openBreak || openBreak.endedAt !== null) return { ok: false, error: "No break is running." };
  if (Date.parse(at) < Date.parse(openBreak.startedAt)) return { ok: false, error: "A break cannot end before it starts." };
  return { ok: true };
}

export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.trunc(total));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/shifts/hours.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shifts/hours.ts lib/shifts/hours.test.ts
git commit -m "Add recorded shift hours arithmetic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Sync rules and driver event schema

**Files:**
- Create: `lib/shifts/syncRules.ts`, `lib/shifts/events.ts`
- Test: `lib/shifts/syncRules.test.ts`, `lib/shifts/events.test.ts`

- [ ] **Step 1: Write the failing sync rules test** `lib/shifts/syncRules.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { correctedFieldPolicy, occurrenceCheck } from "./syncRules";

const receivedAt = new Date("2026-09-29T12:00:00Z");

describe("occurrenceCheck", () => {
  it("accepts a recent in-order event with no flags", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-29T11:59:00Z", receivedAt, previousOccurredAt: "2026-09-29T11:00:00Z" })).toEqual({ ok: true, flags: [] });
  });

  it("allows five minutes of phone clock skew, refuses beyond", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-29T12:04:00Z", receivedAt, previousOccurredAt: null }).ok).toBe(true);
    expect(occurrenceCheck({ occurredAt: "2026-09-29T12:06:00Z", receivedAt, previousOccurredAt: null })).toEqual({
      ok: false,
      error: "The event time is in the future. Check the phone's clock.",
    });
  });

  it("flags events older than 72 hours and events before the previous one", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-26T11:00:00Z", receivedAt, previousOccurredAt: null })).toEqual({ ok: true, flags: ["late_sync"] });
    expect(occurrenceCheck({ occurredAt: "2026-09-29T10:00:00Z", receivedAt, previousOccurredAt: "2026-09-29T11:00:00Z" })).toEqual({ ok: true, flags: ["out_of_order"] });
  });

  it("refuses an unparseable time", () => {
    expect(occurrenceCheck({ occurredAt: "yesterday", receivedAt, previousOccurredAt: null }).ok).toBe(false);
  });
});

describe("correctedFieldPolicy", () => {
  it("lets office corrections win", () => {
    expect(correctedFieldPolicy(new Set(["ended_at"]), "ended_at")).toBe("attach_flagged");
    expect(correctedFieldPolicy(new Set(["started_at"]), "ended_at")).toBe("apply");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/shifts/syncRules.test.ts`
Expected: FAIL, cannot resolve `./syncRules`.

- [ ] **Step 3: Write `lib/shifts/syncRules.ts`**

```ts
/*
  Rules for events that arrive from the phone's offline queue. The legal record
  is when something happened (occurredAt), not when it reached the server, so
  late and out-of-order events are ACCEPTED and flagged for the office, never
  silently corrected. Only a time in the future is refused.
*/

export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const LATE_SYNC_MS = 72 * 60 * 60_000;

export type EventFlag = "late_sync" | "out_of_order";

export function occurrenceCheck(input: {
  occurredAt: string;
  receivedAt: Date;
  previousOccurredAt: string | null;
}): { ok: true; flags: EventFlag[] } | { ok: false; error: string } {
  const t = Date.parse(input.occurredAt);
  if (!Number.isFinite(t)) return { ok: false, error: "The event time is not a valid date." };
  const received = input.receivedAt.getTime();
  if (t > received + MAX_FUTURE_SKEW_MS) return { ok: false, error: "The event time is in the future. Check the phone's clock." };

  const flags: EventFlag[] = [];
  if (received - t > LATE_SYNC_MS) flags.push("late_sync");
  if (input.previousOccurredAt !== null && t < Date.parse(input.previousOccurredAt)) flags.push("out_of_order");
  return { ok: true, flags };
}

/** An office correction to a field wins over a late driver event for the same field. */
export function correctedFieldPolicy(correctedFields: ReadonlySet<string>, field: string): "apply" | "attach_flagged" {
  return correctedFields.has(field) ? "attach_flagged" : "apply";
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npx vitest run lib/shifts/syncRules.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing events test** `lib/shifts/events.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseDriverEvent } from "./events";

const id = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;

const check = {
  type: "check_submitted",
  clientId: id(1),
  occurredAt: "2026-09-29T05:40:00+01:00",
  phase: "start",
  vehicleId: id(2),
  confirmation: "qr",
  qrPayload: "TMSW1:0123456789ABCDEF",
  typedRegistration: null,
  mismatchReason: null,
  odometer: 184220,
  previousEndOdometer: null,
  declarationAccepted: true,
  checklistItemIds: [id(3)],
  defects: [{ clientId: id(4), catalogueItemId: id(3), driverSeverity: null, note: null }],
};

describe("parseDriverEvent", () => {
  it("accepts a valid check", () => {
    const r = parseDriverEvent(check);
    expect(r.ok && r.event.type).toBe("check_submitted");
  });

  it("requires the declaration", () => {
    expect(parseDriverEvent({ ...check, declarationAccepted: false }).ok).toBe(false);
  });

  it("requires the matching confirmation field", () => {
    expect(parseDriverEvent({ ...check, qrPayload: null }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, confirmation: "registration", qrPayload: null, typedRegistration: "AB12CDE" }).ok).toBe(true);
    expect(parseDriverEvent({ ...check, confirmation: "registration", qrPayload: null, typedRegistration: null }).ok).toBe(false);
  });

  it("requires the previous vehicle's end odometer on a swap", () => {
    expect(parseDriverEvent({ ...check, phase: "swap" }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, phase: "swap", previousEndOdometer: 184300 }).ok).toBe(true);
  });

  it("accepts break, end and objection events", () => {
    expect(parseDriverEvent({ type: "break_started", clientId: id(5), occurredAt: "2026-09-29T09:00:00Z" }).ok).toBe(true);
    expect(parseDriverEvent({ type: "break_ended", clientId: id(6), occurredAt: "2026-09-29T09:45:00Z" }).ok).toBe(true);
    expect(parseDriverEvent({ type: "shift_ended", clientId: id(7), occurredAt: "2026-09-29T14:00:00Z", odometer: 184512, newDefects: [] }).ok).toBe(true);
    expect(parseDriverEvent({ type: "objection_raised", clientId: id(8), occurredAt: "2026-09-29T05:50:00Z", defectClientId: id(4), reason: "Leak was a loose fitting, now tight" }).ok).toBe(true);
  });

  it("refuses unknown types and bad ids", () => {
    expect(parseDriverEvent({ type: "teleport", clientId: id(9), occurredAt: "2026-09-29T05:50:00Z" }).ok).toBe(false);
    expect(parseDriverEvent({ ...check, clientId: "not-a-uuid" }).ok).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run lib/shifts/events.test.ts`
Expected: FAIL, cannot resolve `./events`.

- [ ] **Step 7: Write `lib/shifts/events.ts`**

```ts
/*
  The events the driver app queues offline and posts one at a time to
  POST /api/driver/shift/events. Every event carries a phone-generated clientId
  (idempotency key) and the time it actually happened. Client-safe: the driver
  app uses the same types to build events.
*/

import { z } from "zod";

const odometer = z.number().int().min(0).max(9_999_999);

const defectSchema = z.object({
  clientId: z.uuid(),
  catalogueItemId: z.uuid().nullable(),
  driverSeverity: z.enum(["minor", "dangerous"]).nullable(),
  note: z.string().max(1000).nullable(),
});

const base = { clientId: z.uuid(), occurredAt: z.iso.datetime({ offset: true }) };

export const driverEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("check_submitted"),
    phase: z.enum(["start", "swap"]),
    vehicleId: z.uuid(),
    confirmation: z.enum(["qr", "registration"]),
    qrPayload: z.string().max(64).nullable(),
    typedRegistration: z.string().max(16).nullable(),
    mismatchReason: z.string().max(300).nullable(),
    odometer,
    previousEndOdometer: odometer.nullable(),
    declarationAccepted: z.literal(true),
    checklistItemIds: z.array(z.uuid()).min(1).max(500),
    defects: z.array(defectSchema).max(100),
  }),
  z.object({ ...base, type: z.literal("break_started") }),
  z.object({ ...base, type: z.literal("break_ended") }),
  z.object({ ...base, type: z.literal("shift_ended"), odometer, newDefects: z.array(defectSchema).max(100) }),
  z.object({ ...base, type: z.literal("objection_raised"), defectClientId: z.uuid(), reason: z.string().trim().min(3).max(1000) }),
]);

export type DriverEvent = z.infer<typeof driverEventSchema>;
export type CheckSubmittedEvent = Extract<DriverEvent, { type: "check_submitted" }>;
export type QueuedDefect = z.infer<typeof defectSchema>;

export function parseDriverEvent(input: unknown): { ok: true; event: DriverEvent } | { ok: false; error: string } {
  const parsed = driverEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The event is not valid." };
  const event = parsed.data;
  if (event.type === "check_submitted") {
    if (event.confirmation === "qr" && !event.qrPayload) return { ok: false, error: "Scan the cab QR code." };
    if (event.confirmation === "registration" && !event.typedRegistration?.trim()) return { ok: false, error: "Type the registration." };
    if (event.phase === "swap" && event.previousEndOdometer === null) return { ok: false, error: "Enter the odometer of the vehicle you are leaving." };
  }
  return { ok: true, event };
}
```

- [ ] **Step 8: Run both tests, then typecheck**

Run: `npx vitest run lib/shifts/ && npm run typecheck`
Expected: PASS; typecheck clean. If zod 4 rejects `z.iso.datetime({ offset: true })` or `z.uuid()`, check `node_modules/zod` for the v4 names (they exist in 4.4.3) rather than falling back to deprecated forms.

- [ ] **Step 9: Commit**

```bash
git add lib/shifts/syncRules.ts lib/shifts/syncRules.test.ts lib/shifts/events.ts lib/shifts/events.test.ts
git commit -m "Add shift sync rules and the queued driver event schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Shift history CSV

**Files:**
- Create: `lib/shifts/csv.ts`
- Test: `lib/shifts/csv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { csvCell, shiftsToCsv } from "./csv";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
  });
});

describe("shiftsToCsv", () => {
  it("writes a header and one row per shift in the operator's time zone", () => {
    const csv = shiftsToCsv(
      [
        {
          driverName: "J. Smith",
          startedAt: "2026-09-29T04:48:00Z",
          endedAt: "2026-09-29T14:00:00Z",
          vehicles: ["AB12 CDE", "FG34 HIJ"],
          summary: { dutyMinutes: 552, breakMinutes: 45, workedMinutes: 507, mileage: 292, flags: [] },
          corrected: true,
        },
      ],
      "Europe/London",
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Driver,Date,Start,End,Vehicles,Duty,Breaks,Worked (excl. breaks),Mileage,Flags,Corrected by office");
    expect(lines[1]).toBe("J. Smith,2026-09-29,05:48,15:00,AB12 CDE; FG34 HIJ,9:12,0:45,8:27,292,,yes");
  });

  it("leaves end and mileage empty for an open shift", () => {
    const csv = shiftsToCsv(
      [{ driverName: "K", startedAt: "2026-09-29T04:00:00Z", endedAt: null, vehicles: [], summary: { dutyMinutes: 60, breakMinutes: 0, workedMinutes: 60, mileage: null, flags: ["over_13h"] }, corrected: false }],
      "Europe/London",
    );
    expect(csv.trim().split("\r\n")[1]).toBe("K,2026-09-29,05:00,,,1:00,0:00,1:00,,over_13h,no");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/shifts/csv.test.ts`
Expected: FAIL, cannot resolve `./csv`.

- [ ] **Step 3: Write `lib/shifts/csv.ts`**

```ts
/*
  Shift history CSV for /shifts. Times are shown in the operator's time zone.
  Cells that a spreadsheet would treat as a formula are prefixed with a quote.
*/

import { operatorDayInTimeZone } from "../time";
import type { ShiftSummary } from "./hours";

export type ShiftCsvRow = {
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  vehicles: string[];
  summary: ShiftSummary;
  corrected: boolean;
};

export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

const HEADER = ["Driver", "Date", "Start", "End", "Vehicles", "Duty", "Breaks", "Worked (excl. breaks)", "Mileage", "Flags", "Corrected by office"];

export function shiftsToCsv(rows: readonly ShiftCsvRow[], timeZone: string): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.driverName,
        operatorDayInTimeZone(new Date(r.startedAt), timeZone),
        clock(r.startedAt, timeZone),
        r.endedAt ? clock(r.endedAt, timeZone) : "",
        r.vehicles.join("; "),
        hm(r.summary.dutyMinutes),
        hm(r.summary.breakMinutes),
        hm(r.summary.workedMinutes),
        r.summary.mileage === null ? "" : String(r.summary.mileage),
        r.summary.flags.join(" "),
        r.corrected ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/shifts/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/shifts/csv.ts lib/shifts/csv.test.ts
git commit -m "Add the shift history CSV export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Offline queue state machine

**Files:**
- Create: `lib/offline/queue.ts`
- Test: `lib/offline/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyOutcome, classifySyncFailure, enqueue, nextDue, type QueueItem } from "./queue";

const now = 1_000_000;

describe("enqueue", () => {
  it("appends in order and ignores a duplicate id", () => {
    let q: QueueItem<string>[] = [];
    q = enqueue(q, "a", "A", now);
    q = enqueue(q, "b", "B", now);
    q = enqueue(q, "a", "A again", now);
    expect(q.map((i) => [i.id, i.payload])).toEqual([["a", "A"], ["b", "B"]]);
    expect(q[0]).toMatchObject({ attempts: 0, nextAttemptAt: now, lastError: null });
  });
});

describe("nextDue", () => {
  it("only ever offers the head of the queue, and only once it is due", () => {
    const q = enqueue(enqueue([], "a", 1, now), "b", 2, now);
    expect(nextDue(q, now)?.id).toBe("a");
    const waiting = [{ ...q[0], nextAttemptAt: now + 5000 }, q[1]];
    expect(nextDue(waiting, now)).toBeNull();
    expect(nextDue([], now)).toBeNull();
  });
});

describe("applyOutcome", () => {
  const q = enqueue(enqueue([], "a", 1, now), "b", 2, now);

  it("removes a sent item", () => {
    expect(applyOutcome(q, "a", { kind: "sent" }, now)).toEqual({ queue: [q[1]], rejected: null });
  });

  it("backs off a retry", () => {
    const r = applyOutcome(q, "a", { kind: "retry", error: "offline" }, now);
    expect(r.queue[0]).toMatchObject({ id: "a", attempts: 1, nextAttemptAt: now + 5000, lastError: "offline" });
    const r2 = applyOutcome(r.queue, "a", { kind: "retry", error: "offline" }, now);
    expect(r2.queue[0].nextAttemptAt).toBe(now + 10000);
  });

  it("removes a rejected item and hands it back so the driver can be told", () => {
    const r = applyOutcome(q, "a", { kind: "rejected", error: "Vehicle is off the road" }, now);
    expect(r.queue.map((i) => i.id)).toEqual(["b"]);
    expect(r.rejected).toMatchObject({ id: "a", lastError: "Vehicle is off the road" });
  });
});

describe("classifySyncFailure", () => {
  it("retries network and server trouble, stops on auth, rejects other 4xx", () => {
    expect(classifySyncFailure(null)).toBe("retry");
    expect(classifySyncFailure(503)).toBe("retry");
    expect(classifySyncFailure(429)).toBe("retry");
    expect(classifySyncFailure(401)).toBe("stop");
    expect(classifySyncFailure(403)).toBe("stop");
    expect(classifySyncFailure(409)).toBe("rejected");
    expect(classifySyncFailure(400)).toBe("rejected");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/offline/queue.test.ts`
Expected: FAIL, cannot resolve `./queue`.

- [ ] **Step 3: Write `lib/offline/queue.ts`**

```ts
/*
  The driver app's offline queue, as pure state. Items are sent strictly in
  order (a break must not reach the server before the check that started the
  shift), so only the head is ever offered. Storage (IndexedDB) lives in
  lib/offline/idbStore.ts and is kept thin so this logic stays testable.

  Built for shift and walkaround events; written generically so POD saves can
  reuse it later.
*/

import { nextBackoffMs } from "../driver/gpsRetry";

export type QueueItem<T> = {
  id: string;
  payload: T;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
};

export type SendOutcome = { kind: "sent" } | { kind: "retry"; error: string } | { kind: "rejected"; error: string };

export function enqueue<T>(queue: readonly QueueItem<T>[], id: string, payload: T, now: number): QueueItem<T>[] {
  if (queue.some((i) => i.id === id)) return [...queue];
  return [...queue, { id, payload, attempts: 0, nextAttemptAt: now, lastError: null }];
}

export function nextDue<T>(queue: readonly QueueItem<T>[], now: number): QueueItem<T> | null {
  const head = queue[0];
  return head && head.nextAttemptAt <= now ? head : null;
}

export function applyOutcome<T>(
  queue: readonly QueueItem<T>[],
  id: string,
  outcome: SendOutcome,
  now: number,
): { queue: QueueItem<T>[]; rejected: QueueItem<T> | null } {
  const item = queue.find((i) => i.id === id);
  if (!item) return { queue: [...queue], rejected: null };
  const rest = queue.filter((i) => i.id !== id);

  if (outcome.kind === "sent") return { queue: rest, rejected: null };
  if (outcome.kind === "rejected") return { queue: rest, rejected: { ...item, lastError: outcome.error } };

  const retried = { ...item, attempts: item.attempts + 1, nextAttemptAt: now + nextBackoffMs(item.attempts), lastError: outcome.error };
  return { queue: queue.map((i) => (i.id === id ? retried : i)), rejected: null };
}

/** `status` is the HTTP status, or null when the request never got an answer. */
export function classifySyncFailure(status: number | null): "retry" | "stop" | "rejected" {
  if (status === null) return "retry";
  if (status === 401 || status === 403) return "stop";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "rejected";
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run lib/offline/queue.test.ts`
Expected: PASS. (Backoff base is `GPS_BACKOFF_BASE_MS` = 5000, doubling, from `lib/driver/gpsRetry.ts`.)

- [ ] **Step 5: Commit**

```bash
git add lib/offline/queue.ts lib/offline/queue.test.ts
git commit -m "Add the offline event queue state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Dashboard fleet readiness

**Files:**
- Create: `lib/dashboard/fleetReadiness.ts`
- Test: `lib/dashboard/fleetReadiness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fleetAttention, fleetTiles, fleetTodayRows, type FleetInput } from "./fleetReadiness";

const now = new Date("2026-09-29T12:00:00Z");

const input: FleetInput = {
  now,
  activeDriverCount: 3,
  vehicles: [
    { id: "v1", registration: "AB12 CDE", vor: true },
    { id: "v2", registration: "FG34 HIJ", vor: false },
    { id: "v3", registration: "KL56 MNO", vor: false },
  ],
  shifts: [
    { id: "s1", driverId: "d1", driverName: "J. Smith", startedAt: "2026-09-29T04:40:00Z", endedAt: null, onBreak: true, currentVehicleId: "v2", flags: [] },
    { id: "s2", driverId: "d2", driverName: "M. Jones", startedAt: "2026-09-28T18:00:00Z", endedAt: null, onBreak: false, currentVehicleId: null, flags: [] },
  ],
  checksToday: [
    { id: "c1", vehicleId: "v1", driverId: "d1", driverName: "J. Smith", performedAt: "2026-09-29T04:42:00Z", result: "dangerous", assignedVehicleMismatch: false },
    { id: "c2", vehicleId: "v2", driverId: "d1", driverName: "J. Smith", performedAt: "2026-09-29T04:55:00Z", result: "minor", assignedVehicleMismatch: true },
  ],
  openDefects: [
    { id: "f1", vehicleId: "v1", finalSeverity: "dangerous", label: "Brakes and air build-up: Audible air leak", createdAt: "2026-09-29T04:42:00Z" },
    { id: "f2", vehicleId: "v2", finalSeverity: "minor", label: "Horn: Horn does not work", createdAt: "2026-09-29T04:55:00Z" },
  ],
  pendingObjections: [{ id: "o1", vehicleId: "v1", defectLabel: "Brakes and air build-up: Audible air leak", driverName: "J. Smith", raisedAt: "2026-09-29T04:50:00Z" }],
  vehiclesOnJobsToday: ["v2", "v3"],
};

describe("fleetTiles", () => {
  it("counts shifts, checks, defects and objections", () => {
    expect(fleetTiles(input)).toEqual({
      onShift: 2,
      activeDrivers: 3,
      vehiclesChecked: 2,
      vehiclesOutUnchecked: 1,
      openDefects: 2,
      dangerousDefects: 1,
      pendingObjections: 1,
    });
  });
});

describe("fleetAttention", () => {
  it("lists dangerous defects and objections first, then the warnings", () => {
    const items = fleetAttention(input);
    expect(items.map((i) => i.id)).toEqual([
      "fleet-defect-f1",
      "fleet-objection-o1",
      "fleet-unchecked-v3",
      "fleet-stale-s2",
      "fleet-mismatch-c2",
    ]);
    expect(items[0]).toMatchObject({ title: "AB12 CDE off the road: Brakes and air build-up: Audible air leak", href: "/maintenance?tab=walkaround" });
    expect(items[3]).toMatchObject({ title: "M. Jones has been on shift for over 16 hours", href: "/shifts" });
  });
});

describe("fleetTodayRows", () => {
  it("gives one row per vehicle with its latest check and shift", () => {
    const rows = fleetTodayRows(input);
    expect(rows.find((r) => r.vehicleId === "v2")).toMatchObject({ registration: "FG34 HIJ", driverName: "J. Smith", checkResult: "minor", shiftState: "on_break", openDefects: 1, dangerousDefects: 0, vor: false });
    expect(rows.find((r) => r.vehicleId === "v3")).toMatchObject({ driverName: null, checkResult: null, shiftState: "none", onJobToday: true });
    expect(rows.find((r) => r.vehicleId === "v1")).toMatchObject({ checkResult: "dangerous", dangerousDefects: 1, vor: true });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/dashboard/fleetReadiness.test.ts`
Expected: FAIL, cannot resolve `./fleetReadiness`.

- [ ] **Step 3: Write `lib/dashboard/fleetReadiness.ts`**

```ts
/*
  Dashboard tiles, "Needs attention" items and the /shifts "Fleet today" table,
  computed from rows the page has already loaded. Pure.
  Attention items use the existing AttentionItem shape from ./aggregate.
*/

import type { CheckResult, Severity } from "../walkaround/types";
import { STALE_OPEN_MINUTES } from "../shifts/hours";
import type { AttentionItem } from "./aggregate";

export type FleetVehicle = { id: string; registration: string; vor: boolean };
export type FleetShift = {
  id: string;
  driverId: string;
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  onBreak: boolean;
  currentVehicleId: string | null;
  flags: string[];
};
export type FleetCheck = {
  id: string;
  vehicleId: string;
  driverId: string;
  driverName: string;
  performedAt: string;
  result: CheckResult;
  assignedVehicleMismatch: boolean;
};
export type FleetDefect = { id: string; vehicleId: string; finalSeverity: Severity; label: string; createdAt: string };
export type FleetObjection = { id: string; vehicleId: string; defectLabel: string; driverName: string; raisedAt: string };

export type FleetInput = {
  now: Date;
  activeDriverCount: number;
  vehicles: FleetVehicle[];
  /** Open shifts plus shifts that started today. */
  shifts: FleetShift[];
  /** Start and swap checks performed today (operator day). */
  checksToday: FleetCheck[];
  /** Unrectified defects. */
  openDefects: FleetDefect[];
  pendingObjections: FleetObjection[];
  vehiclesOnJobsToday: string[];
};

export type FleetTiles = {
  onShift: number;
  activeDrivers: number;
  vehiclesChecked: number;
  vehiclesOutUnchecked: number;
  openDefects: number;
  dangerousDefects: number;
  pendingObjections: number;
};

export type ShiftState = "none" | "on_duty" | "on_break" | "ended";

export type FleetTodayRow = {
  vehicleId: string;
  registration: string;
  driverName: string | null;
  checkTime: string | null;
  checkResult: CheckResult | null;
  shiftState: ShiftState;
  shiftStartedAt: string | null;
  openDefects: number;
  dangerousDefects: number;
  vor: boolean;
  onJobToday: boolean;
};

function hoursSince(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(iso)) / 3_600_000);
}

export function fleetTiles(input: FleetInput): FleetTiles {
  const checked = new Set(input.checksToday.map((c) => c.vehicleId));
  return {
    onShift: input.shifts.filter((s) => s.endedAt === null).length,
    activeDrivers: input.activeDriverCount,
    vehiclesChecked: checked.size,
    vehiclesOutUnchecked: new Set(input.vehiclesOnJobsToday.filter((v) => !checked.has(v))).size,
    openDefects: input.openDefects.length,
    dangerousDefects: input.openDefects.filter((d) => d.finalSeverity === "dangerous").length,
    pendingObjections: input.pendingObjections.length,
  };
}

export function fleetAttention(input: FleetInput): AttentionItem[] {
  const reg = new Map(input.vehicles.map((v) => [v.id, v.registration]));
  const name = (id: string) => reg.get(id) ?? "A vehicle";
  const checked = new Set(input.checksToday.map((c) => c.vehicleId));
  const items: AttentionItem[] = [];

  for (const d of input.openDefects.filter((x) => x.finalSeverity === "dangerous")) {
    items.push({ id: `fleet-defect-${d.id}`, title: `${name(d.vehicleId)} off the road: ${d.label}`, meta: "Dangerous walkaround defect", ageHours: hoursSince(d.createdAt, input.now), href: "/maintenance?tab=walkaround" });
  }
  for (const o of input.pendingObjections) {
    items.push({ id: `fleet-objection-${o.id}`, title: `${o.driverName} objects to the VOR on ${name(o.vehicleId)}`, meta: `Awaiting an admin decision: ${o.defectLabel}`, ageHours: hoursSince(o.raisedAt, input.now), href: "/maintenance?tab=walkaround" });
  }
  for (const v of [...new Set(input.vehiclesOnJobsToday)].filter((id) => !checked.has(id))) {
    items.push({ id: `fleet-unchecked-${v}`, title: `${name(v)} is on a job today with no walkaround check`, meta: "No check recorded today", ageHours: 0, href: "/shifts" });
  }
  for (const s of input.shifts.filter((x) => x.endedAt === null && hoursSince(x.startedAt, input.now) * 60 > STALE_OPEN_MINUTES)) {
    items.push({ id: `fleet-stale-${s.id}`, title: `${s.driverName} has been on shift for over 16 hours`, meta: "Did they forget to end the shift?", ageHours: hoursSince(s.startedAt, input.now), href: "/shifts" });
  }
  for (const c of input.checksToday.filter((x) => x.assignedVehicleMismatch)) {
    items.push({ id: `fleet-mismatch-${c.id}`, title: `${c.driverName} checked ${name(c.vehicleId)}, not their assigned vehicle`, meta: "Different vehicle chosen at shift start", ageHours: hoursSince(c.performedAt, input.now), href: "/shifts" });
  }
  return items;
}

export function fleetTodayRows(input: FleetInput): FleetTodayRow[] {
  const jobs = new Set(input.vehiclesOnJobsToday);
  return input.vehicles.map((v) => {
    const checks = input.checksToday.filter((c) => c.vehicleId === v.id).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    const latest = checks[0] ?? null;
    const shift = input.shifts.find((s) => s.currentVehicleId === v.id && s.endedAt === null) ?? null;
    const defects = input.openDefects.filter((d) => d.vehicleId === v.id);
    const shiftState: ShiftState = shift ? (shift.onBreak ? "on_break" : "on_duty") : latest ? "ended" : "none";
    return {
      vehicleId: v.id,
      registration: v.registration,
      driverName: shift?.driverName ?? latest?.driverName ?? null,
      checkTime: latest?.performedAt ?? null,
      checkResult: latest?.result ?? null,
      shiftState,
      shiftStartedAt: shift?.startedAt ?? null,
      openDefects: defects.length,
      dangerousDefects: defects.filter((d) => d.finalSeverity === "dangerous").length,
      vor: v.vor,
      onJobToday: jobs.has(v.id),
    };
  });
}
```

- [ ] **Step 4: Run the test, confirm it passes; run the whole suite**

Run: `npx vitest run lib/dashboard/fleetReadiness.test.ts && npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/fleetReadiness.ts lib/dashboard/fleetReadiness.test.ts
git commit -m "Add dashboard fleet readiness tiles and attention items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Driver state types and offline projection

The driver app shows what the phone knows, including events still waiting to sync: a check submitted in a dead spot must show "On shift (waiting to sync)" straight away. This task defines the state shape `GET /api/driver/shift` returns and a pure function that applies queued events on top of it.

**Files:**
- Create: `lib/walkaround/driverState.ts`, `lib/shifts/projection.ts`
- Test: `lib/shifts/projection.test.ts`

- [ ] **Step 1: Write `lib/walkaround/driverState.ts`** (types only)

```ts
/*
  What GET /api/driver/shift returns, and what the driver app renders after
  applying queued events (lib/shifts/projection.ts). Client-safe types only.
*/

import type { TimeInterval } from "../shifts/hours";
import type { CatalogueItem, CheckResult, ObjectionStatus, Severity, SeveritySource } from "./types";

export type DriverDefectView = {
  clientId: string;
  label: string;
  finalSeverity: Severity;
  severitySource: SeveritySource;
  /** "Classed dangerous in the DVSA baseline checklist." etc. Null for minor. */
  reason: string | null;
  guidance: string | null;
  note: string | null;
  photoCount: number;
  objection: null | { status: ObjectionStatus; decisionNote: string | null };
};

export type DriverVehicleOption = { id: string; registration: string; vor: boolean };

export type DriverShiftState = {
  today: string;
  companyName: string | null;
  onCallPhone: string | null;
  assignedVehicle: { id: string; registration: string } | null;
  vehicles: DriverVehicleOption[];
  catalogue: CatalogueItem[];
  openShift: null | {
    id: string;
    startedAt: string;
    onBreak: boolean;
    breaks: TimeInterval[];
    currentVehicle: null | {
      vehicleId: string;
      registration: string;
      startOdometer: number;
      checkResult: CheckResult;
    };
  };
  /** The latest check that took a vehicle off the road and has not been superseded. */
  blockingCheck: null | {
    checkClientId: string;
    vehicleId: string;
    registration: string;
    performedAt: string;
    defects: DriverDefectView[];
  };
  /** True when the phone holds events the server has not accepted yet. */
  syncPending: boolean;
};
```

- [ ] **Step 2: Write the failing projection test** `lib/shifts/projection.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { DriverShiftState } from "../walkaround/driverState";
import type { CatalogueItem } from "../walkaround/types";
import type { DriverEvent } from "./events";
import { projectDriverState } from "./projection";

const leak: CatalogueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: null,
  code: "brakes.air_leak",
  category: "brakes_air",
  itemLabel: "Brakes and air build-up",
  defectLabel: "Audible air leak",
  guidance: "Listen.",
  severity: "dangerous",
  appliesTo: "both",
  sortOrder: 10,
  retiredAt: null,
};

const server: DriverShiftState = {
  today: "2026-09-29",
  companyName: "Acme Haulage",
  onCallPhone: "07700 900000",
  assignedVehicle: { id: "v1", registration: "AB12 CDE" },
  vehicles: [
    { id: "v1", registration: "AB12 CDE", vor: false },
    { id: "v2", registration: "FG34 HIJ", vor: false },
  ],
  catalogue: [leak],
  openShift: null,
  blockingCheck: null,
  syncPending: false,
};

function check(over: Partial<Extract<DriverEvent, { type: "check_submitted" }>>): DriverEvent {
  return {
    type: "check_submitted",
    clientId: "c1",
    occurredAt: "2026-09-29T05:40:00Z",
    phase: "start",
    vehicleId: "v1",
    confirmation: "registration",
    qrPayload: null,
    typedRegistration: "AB12CDE",
    mismatchReason: null,
    odometer: 1000,
    previousEndOdometer: null,
    declarationAccepted: true,
    checklistItemIds: [leak.id],
    defects: [],
    ...over,
  };
}

describe("projectDriverState", () => {
  it("returns the server state untouched when nothing is queued", () => {
    expect(projectDriverState(server, [])).toEqual(server);
  });

  it("opens a shift locally for a passing check", () => {
    const s = projectDriverState(server, [check({})]);
    expect(s.syncPending).toBe(true);
    expect(s.openShift).toMatchObject({ startedAt: "2026-09-29T05:40:00Z", onBreak: false, currentVehicle: { vehicleId: "v1", registration: "AB12 CDE", startOdometer: 1000, checkResult: "pass" } });
  });

  it("shows a blocking check, with reasons, for a dangerous one", () => {
    const s = projectDriverState(server, [check({ defects: [{ clientId: "d1", catalogueItemId: leak.id, driverSeverity: null, note: "hiss at rear" }] })]);
    expect(s.openShift).toBeNull();
    expect(s.blockingCheck).toMatchObject({
      checkClientId: "c1",
      registration: "AB12 CDE",
      defects: [{ clientId: "d1", label: "Brakes and air build-up: Audible air leak", finalSeverity: "dangerous", reason: "Classed dangerous in the DVSA baseline checklist.", guidance: "Listen.", note: "hiss at rear", objection: null }],
    });
  });

  it("tracks breaks, swaps and the end of the shift", () => {
    let s = projectDriverState(server, [check({}), { type: "break_started", clientId: "b1", occurredAt: "2026-09-29T09:00:00Z" }]);
    expect(s.openShift?.onBreak).toBe(true);
    s = projectDriverState(server, [check({}), { type: "break_started", clientId: "b1", occurredAt: "2026-09-29T09:00:00Z" }, { type: "break_ended", clientId: "b2", occurredAt: "2026-09-29T09:45:00Z" }]);
    expect(s.openShift?.onBreak).toBe(false);
    expect(s.openShift?.breaks).toEqual([{ startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:45:00Z" }]);
    s = projectDriverState(server, [check({}), check({ clientId: "c2", phase: "swap", vehicleId: "v2", previousEndOdometer: 1100, odometer: 5000 })]);
    expect(s.openShift?.currentVehicle).toMatchObject({ vehicleId: "v2", startOdometer: 5000 });
    s = projectDriverState(server, [check({}), { type: "shift_ended", clientId: "e1", occurredAt: "2026-09-29T14:00:00Z", odometer: 1200, newDefects: [] }]);
    expect(s.openShift).toBeNull();
  });

  it("marks an objection as pending on the blocking defect", () => {
    const s = projectDriverState(server, [
      check({ defects: [{ clientId: "d1", catalogueItemId: leak.id, driverSeverity: null, note: null }] }),
      { type: "objection_raised", clientId: "o1", occurredAt: "2026-09-29T05:50:00Z", defectClientId: "d1", reason: "Fitting was loose, now tight" },
    ]);
    expect(s.blockingCheck?.defects[0].objection).toEqual({ status: "pending", decisionNote: null });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run lib/shifts/projection.test.ts`
Expected: FAIL, cannot resolve `./projection`.

- [ ] **Step 4: Write `lib/shifts/projection.ts`**

```ts
/*
  Apply the phone's queued (not yet accepted) events on top of the last server
  state, so the driver sees the result of what they did even with no signal.
  Severity is recomputed with the same rules the server uses
  (lib/walkaround/severity.ts); the server stays the authority once it syncs.
*/

import { checkResult, dangerReason, resolveDefect, type ResolvedDefect } from "../walkaround/severity";
import type { DriverDefectView, DriverShiftState } from "../walkaround/driverState";
import type { CatalogueItem } from "../walkaround/types";
import type { DriverEvent, QueuedDefect } from "./events";

function resolveAll(defects: readonly QueuedDefect[], catalogue: ReadonlyMap<string, CatalogueItem>): ResolvedDefect[] {
  const out: ResolvedDefect[] = [];
  for (const d of defects) {
    const r = resolveDefect(d, catalogue);
    if (r.ok) out.push(r.value);
  }
  return out;
}

function view(d: ResolvedDefect, catalogue: ReadonlyMap<string, CatalogueItem>, companyName: string | null): DriverDefectView {
  return {
    clientId: d.clientId,
    label: d.label,
    finalSeverity: d.finalSeverity,
    severitySource: d.severitySource,
    reason: dangerReason(d, companyName),
    guidance: d.catalogueItemId ? catalogue.get(d.catalogueItemId)?.guidance ?? null : null,
    note: d.note,
    photoCount: 0,
    objection: null,
  };
}

export function projectDriverState(server: DriverShiftState, pending: readonly DriverEvent[]): DriverShiftState {
  if (pending.length === 0) return server;

  const catalogue = new Map(server.catalogue.map((i) => [i.id, i]));
  const registration = (id: string) => server.vehicles.find((v) => v.id === id)?.registration ?? "Vehicle";
  let state: DriverShiftState = { ...server, syncPending: true };

  for (const event of pending) {
    if (event.type === "check_submitted") {
      const resolved = resolveAll(event.defects, catalogue);
      const result = checkResult(resolved);
      if (result === "dangerous") {
        state = {
          ...state,
          blockingCheck: {
            checkClientId: event.clientId,
            vehicleId: event.vehicleId,
            registration: registration(event.vehicleId),
            performedAt: event.occurredAt,
            defects: resolved.map((d) => view(d, catalogue, server.companyName)),
          },
          openShift: state.openShift && event.phase === "swap" ? { ...state.openShift, currentVehicle: null } : state.openShift,
        };
        continue;
      }
      const currentVehicle = { vehicleId: event.vehicleId, registration: registration(event.vehicleId), startOdometer: event.odometer, checkResult: result };
      state = {
        ...state,
        blockingCheck: null,
        openShift:
          event.phase === "swap" && state.openShift
            ? { ...state.openShift, currentVehicle }
            : { id: `pending:${event.clientId}`, startedAt: event.occurredAt, onBreak: false, breaks: [], currentVehicle },
      };
    } else if (event.type === "break_started" && state.openShift) {
      state = { ...state, openShift: { ...state.openShift, onBreak: true, breaks: [...state.openShift.breaks, { startedAt: event.occurredAt, endedAt: null }] } };
    } else if (event.type === "break_ended" && state.openShift) {
      const breaks = state.openShift.breaks.map((b) => (b.endedAt === null ? { ...b, endedAt: event.occurredAt } : b));
      state = { ...state, openShift: { ...state.openShift, onBreak: false, breaks } };
    } else if (event.type === "shift_ended") {
      state = { ...state, openShift: null, blockingCheck: null };
    } else if (event.type === "objection_raised" && state.blockingCheck) {
      const defects = state.blockingCheck.defects.map((d) =>
        d.clientId === event.defectClientId ? { ...d, objection: { status: "pending" as const, decisionNote: null } } : d,
      );
      state = { ...state, blockingCheck: { ...state.blockingCheck, defects } };
    }
  }
  return state;
}
```

- [ ] **Step 5: Run the test, confirm it passes, typecheck**

Run: `npx vitest run lib/shifts/projection.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/walkaround/driverState.ts lib/shifts/projection.ts lib/shifts/projection.test.ts
git commit -m "Add the driver shift state shape and offline projection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase B: SQL (written here, applied by hand later)

These files are NOT run by any tool. They are applied by hand in the Supabase SQL editor after merge, in order, and recorded in `docs/sql/prodfix_00_APPLY_ORDER.md`. Never run `supabase db push`. Read `docs/sql/prodfix_30_vehicle_licence_gate.sql` and `docs/sql/rls_10a_pod_files_policies.sql` first: they are the house style (guard `do` block at the top, `begin; ... commit;`, a VERIFY comment block at the end).

### Task 12: Tables, RLS and grants (`shifts_01_tables.sql`)

**Files:**
- Create: `docs/sql/shifts_01_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- shifts_01: tables for driver shifts and DVSA walkaround checks.
-- Spec: docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md
--
-- Every table here is READ-ONLY from the browser: RLS allows SELECT within the
-- caller's tenant (or company, for the catalogue and settings) and all client
-- DML is revoked. Writes happen only in route handlers using the service role,
-- through the RPCs in shifts_04, after the route has authorized the caller.
-- A walkaround check is a DVSA written record; the browser must not be able to
-- edit or delete it.
--
-- Apply after rls_02 (can_access_tenant, get_my_company_id, get_my_role).
-- Safe to re-run.

begin;

do $$
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null
     or to_regprocedure('public.get_my_company_id()') is null
     or to_regprocedure('public.get_my_role()') is null then
    raise exception 'shifts_01: rls_02 helpers are missing. Nothing changed.';
  end if;
end $$;

-- Catalogue: company_id null = the locked baseline (seeded in shifts_02,
-- guarded by a trigger in shifts_03).
create table if not exists public.defect_catalogue_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id),
  code          text not null,
  category      text not null,
  item_label    text not null,
  defect_label  text not null,
  guidance      text not null default '',
  severity      text not null check (severity in ('minor', 'dangerous')),
  applies_to    text not null default 'vehicle' check (applies_to in ('vehicle', 'trailer', 'both')),
  sort_order    int  not null default 0,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint defect_catalogue_company_code_prefix check (company_id is null or code like 'co.%')
);
create unique index if not exists defect_catalogue_baseline_code
  on public.defect_catalogue_items (code) where company_id is null;
create unique index if not exists defect_catalogue_company_code
  on public.defect_catalogue_items (company_id, code) where company_id is not null;

create table if not exists public.walkaround_settings (
  company_id          uuid primary key references public.companies(id),
  on_call_phone       text check (on_call_phone is null or length(on_call_phone) <= 32),
  updated_by_user_id  uuid,
  updated_at          timestamptz not null default now()
);

create table if not exists public.driver_shifts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  driver_id           uuid not null references public.drivers(id),
  client_id           uuid not null,
  end_client_id       uuid,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  start_received_at   timestamptz not null default now(),
  end_received_at     timestamptz,
  ended_by            text check (ended_by in ('driver', 'office')),
  end_defect_answer   text check (end_defect_answer in ('none', 'reported')),
  flags               text[] not null default '{}',
  created_by_user_id  uuid,
  created_at          timestamptz not null default now(),
  constraint driver_shifts_client unique (tenant_id, client_id),
  constraint driver_shifts_end_client unique (tenant_id, end_client_id),
  constraint driver_shifts_order check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists driver_shifts_one_open
  on public.driver_shifts (driver_id) where ended_at is null;
create index if not exists driver_shifts_tenant_started on public.driver_shifts (tenant_id, started_at desc);

create table if not exists public.shift_breaks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  shift_id            uuid not null references public.driver_shifts(id) on delete restrict,
  client_id           uuid not null,
  end_client_id       uuid,
  started_at          timestamptz not null,
  ended_at            timestamptz,
  start_received_at   timestamptz not null default now(),
  end_received_at     timestamptz,
  flags               text[] not null default '{}',
  constraint shift_breaks_client unique (tenant_id, client_id),
  constraint shift_breaks_end_client unique (tenant_id, end_client_id),
  constraint shift_breaks_order check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists shift_breaks_one_open on public.shift_breaks (shift_id) where ended_at is null;

create table if not exists public.walkaround_checks (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id),
  driver_id                uuid not null references public.drivers(id),
  shift_id                 uuid references public.driver_shifts(id) on delete restrict,
  vehicle_id               uuid not null references public.vehicles(id) on delete restrict,
  client_id                uuid not null,
  phase                    text not null check (phase in ('start', 'swap', 'end_of_shift')),
  performed_at             timestamptz not null,
  received_at              timestamptz not null default now(),
  odometer                 int check (odometer is null or odometer >= 0),
  vehicle_confirmation     text not null check (vehicle_confirmation in ('qr', 'registration', 'none')),
  vehicle_mismatch_reason  text,
  result                   text not null check (result in ('pass', 'minor', 'dangerous')),
  checklist_snapshot       jsonb not null,
  declaration_accepted     boolean not null,
  flags                    text[] not null default '{}',
  constraint walkaround_checks_client unique (tenant_id, client_id)
);
create index if not exists walkaround_checks_tenant_performed on public.walkaround_checks (tenant_id, performed_at desc);
create index if not exists walkaround_checks_vehicle on public.walkaround_checks (vehicle_id, performed_at desc);

create table if not exists public.shift_vehicle_periods (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id),
  shift_id             uuid not null references public.driver_shifts(id) on delete restrict,
  vehicle_id           uuid not null references public.vehicles(id) on delete restrict,
  walkaround_check_id  uuid not null references public.walkaround_checks(id) on delete restrict,
  started_at           timestamptz not null,
  ended_at             timestamptz,
  start_odometer       int not null check (start_odometer >= 0),
  end_odometer         int check (end_odometer is null or end_odometer >= 0)
);
create unique index if not exists shift_vehicle_periods_one_open on public.shift_vehicle_periods (shift_id) where ended_at is null;

create table if not exists public.walkaround_defects (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id),
  check_id               uuid not null references public.walkaround_checks(id) on delete restrict,
  vehicle_id             uuid not null references public.vehicles(id) on delete restrict,
  catalogue_item_id      uuid references public.defect_catalogue_items(id) on delete restrict,
  client_id              uuid not null,
  label                  text not null,
  catalogue_severity     text check (catalogue_severity in ('minor', 'dangerous')),
  final_severity         text not null check (final_severity in ('minor', 'dangerous')),
  escalated_by_driver    boolean not null default false,
  severity_source        text not null check (severity_source in ('baseline', 'company', 'driver')),
  note                   text,
  photo_paths            text[] not null default '{}',
  maintenance_record_id  uuid references public.maintenance_records(id) on delete restrict,
  rectified_at           timestamptz,
  created_at             timestamptz not null default now(),
  constraint walkaround_defects_client unique (tenant_id, client_id),
  constraint walkaround_defects_no_downgrade check (not (catalogue_severity = 'dangerous' and final_severity = 'minor'))
);
create index if not exists walkaround_defects_vehicle_open on public.walkaround_defects (vehicle_id) where rectified_at is null;
create index if not exists walkaround_defects_maintenance on public.walkaround_defects (maintenance_record_id);

create table if not exists public.defect_objections (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id),
  defect_id                 uuid not null references public.walkaround_defects(id) on delete restrict,
  driver_id                 uuid not null references public.drivers(id),
  client_id                 uuid not null,
  reason                    text not null check (length(reason) between 3 and 1000),
  status                    text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  raised_at                 timestamptz not null,
  received_at               timestamptz not null default now(),
  decided_by_user_id        uuid,
  decided_at                timestamptz,
  decision_note             text,
  liability_notice_version  text,
  liability_accepted        boolean not null default false,
  constraint defect_objections_client unique (tenant_id, client_id),
  constraint defect_objections_approval check (status <> 'approved' or (liability_accepted and liability_notice_version is not null))
);
create unique index if not exists defect_objections_one_pending on public.defect_objections (defect_id) where status = 'pending';

create table if not exists public.shift_corrections (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id),
  shift_id              uuid not null references public.driver_shifts(id) on delete restrict,
  corrected_by_user_id  uuid not null,
  corrected_at          timestamptz not null default now(),
  field                 text not null check (field in ('started_at', 'ended_at', 'office_started')),
  old_value             text,
  new_value             text,
  reason                text not null check (length(btrim(reason)) >= 3)
);

alter table public.vehicles add column if not exists walkaround_qr_token_hash text;
create unique index if not exists vehicles_walkaround_qr_token_hash
  on public.vehicles (walkaround_qr_token_hash) where walkaround_qr_token_hash is not null;

-- RLS: read within tenant (or company), no client writes.
do $$
declare
  t text;
begin
  foreach t in array array['driver_shifts', 'shift_breaks', 'walkaround_checks', 'shift_vehicle_periods',
                           'walkaround_defects', 'defect_objections', 'shift_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists tenant_read on public.%I', t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (public.can_access_tenant(tenant_id))', t);
  end loop;
end $$;

alter table public.defect_catalogue_items enable row level security;
revoke all on public.defect_catalogue_items from anon, authenticated;
grant select on public.defect_catalogue_items to authenticated;
drop policy if exists catalogue_read on public.defect_catalogue_items;
create policy catalogue_read on public.defect_catalogue_items for select to authenticated using (
  company_id is null
  or company_id = public.get_my_company_id()
  or public.get_my_role() = 'super_admin'
);

alter table public.walkaround_settings enable row level security;
revoke all on public.walkaround_settings from anon, authenticated;
grant select on public.walkaround_settings to authenticated;
drop policy if exists settings_read on public.walkaround_settings;
create policy settings_read on public.walkaround_settings for select to authenticated using (
  company_id = public.get_my_company_id() or public.get_my_role() = 'super_admin'
);

commit;

-- ===========================================================================
-- VERIFY (run shifts_verify.sql for the full check).
--   select relname, relrowsecurity from pg_class
--   where relname in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods',
--                     'walkaround_defects','defect_objections','shift_corrections',
--                     'defect_catalogue_items','walkaround_settings');
--   -- expect relrowsecurity = true on all nine rows.
```

- [ ] **Step 2: Sanity-check the file has no em-dashes and balanced begin/commit**

Run: `grep -cP "\x{2014}" docs/sql/shifts_01_tables.sql; grep -c "^begin;" docs/sql/shifts_01_tables.sql; grep -c "^commit;" docs/sql/shifts_01_tables.sql`
Expected: `0`, `1`, `1`.

- [ ] **Step 3: Commit**

```bash
git add docs/sql/shifts_01_tables.sql
git commit -m "Add shifts_01: shift and walkaround tables, read-only from the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Baseline seed and the drift test (`shifts_02_catalogue_seed.sql`)

**Files:**
- Create: `docs/sql/shifts_02_catalogue_seed.sql`
- Test: `lib/walkaround/baselineSql.test.ts`

- [ ] **Step 1: Write the failing drift test** `lib/walkaround/baselineSql.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_CATALOGUE } from "./baseline";

/*
  docs/sql/shifts_02_catalogue_seed.sql seeds the same baseline as
  lib/walkaround/baseline.ts. The app reads severity from the database, so a
  drift here would silently change which defects take a vehicle off the road.
*/
const sql = readFileSync(join(process.cwd(), "docs/sql/shifts_02_catalogue_seed.sql"), "utf8");
const ROW = /^\s*\('([a-z0-9_.]+)', '([a-z_]+)', '(?:[^']|'')*', '(?:[^']|'')*', '(minor|dangerous)', '(vehicle|trailer|both)', (\d+), '(?:[^']|'')*'\),?$/gm;

describe("baseline seed SQL", () => {
  const rows = [...sql.matchAll(ROW)].map((m) => ({ code: m[1], category: m[2], severity: m[3], appliesTo: m[4], sortOrder: Number(m[5]) }));

  it("seeds exactly the baseline codes", () => {
    expect(rows.map((r) => r.code).sort()).toEqual(BASELINE_CATALOGUE.map((e) => e.code).sort());
  });

  it("seeds the same category, severity, applies-to and order for every code", () => {
    for (const e of BASELINE_CATALOGUE) {
      const row = rows.find((r) => r.code === e.code);
      expect(row, e.code).toEqual({ code: e.code, category: e.category, severity: e.severity, appliesTo: e.appliesTo, sortOrder: e.sortOrder });
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/walkaround/baselineSql.test.ts`
Expected: FAIL, ENOENT on the SQL file.

- [ ] **Step 3: Write `docs/sql/shifts_02_catalogue_seed.sql`**

```sql
-- shifts_02: seed the locked DVSA-based baseline walkaround catalogue.
-- The rows below MUST match lib/walkaround/baseline.ts exactly;
-- lib/walkaround/baselineSql.test.ts fails when they drift. Change both together.
--
-- Apply after shifts_01. Safe to re-run: existing baseline rows are updated in
-- place by code, so a re-run after editing baseline.ts brings the database in
-- line. The session setting lets this script past the baseline guard trigger
-- installed by shifts_03 (it only matters on a re-run after shifts_03).

begin;

set local app.walkaround_seed = 'on';

insert into public.defect_catalogue_items
  (code, category, item_label, defect_label, severity, applies_to, sort_order, guidance)
values
<<the 38 rows below>>
on conflict (code) where company_id is null do update set
  category     = excluded.category,
  item_label   = excluded.item_label,
  defect_label = excluded.defect_label,
  severity     = excluded.severity,
  applies_to   = excluded.applies_to,
  sort_order   = excluded.sort_order,
  guidance     = excluded.guidance,
  retired_at   = null;

commit;

-- VERIFY: expect 38 rows, 24 dangerous.
--   select count(*), count(*) filter (where severity = 'dangerous')
--   from public.defect_catalogue_items where company_id is null;
```

Replace `<<the 38 rows below>>` with these 38 lines verbatim (one row per line, the last line has no trailing comma):

```sql
  ('mirrors_glass.mirror_missing_broken', 'mirrors_glass', 'Mirrors and glass', 'Mirror missing, broken or cannot be adjusted', 'dangerous', 'vehicle', 10, 'Check every mirror is present, secure, unbroken and gives a clear view.'),
  ('mirrors_glass.windscreen_view', 'mirrors_glass', 'Mirrors and glass', 'Windscreen damage in the driver''s line of sight', 'dangerous', 'vehicle', 20, 'Look for cracks, chips or discolouration in the area swept by the wipers.'),
  ('mirrors_glass.windscreen_other', 'mirrors_glass', 'Mirrors and glass', 'Windscreen or window damage outside the driver''s line of sight', 'minor', 'vehicle', 30, 'Report any other crack or chip so it can be repaired before it spreads.'),
  ('wipers.inoperative', 'wipers_washers', 'Wipers and washers', 'Wipers do not work or blades are missing or worn', 'dangerous', 'vehicle', 40, 'Operate the wipers and washers; the blades must clear the screen.'),
  ('wipers.washer_empty', 'wipers_washers', 'Wipers and washers', 'Washer fluid empty or washers do not spray', 'minor', 'vehicle', 50, 'Operate the washers and top up the fluid if needed.'),
  ('front_view.obstructed', 'front_view', 'Front view', 'Driver''s view obstructed by stickers or objects', 'minor', 'vehicle', 60, 'Nothing should block the view through the windscreen in the area swept by the wipers.'),
  ('dashboard.brake_warning', 'dashboard', 'Dashboard warning lights and gauges', 'Brake, ABS or EBS warning light stays on', 'dangerous', 'vehicle', 70, 'Switch on the ignition; every warning light must go out after the self-test.'),
  ('dashboard.other_warning', 'dashboard', 'Dashboard warning lights and gauges', 'Other warning light stays on or a gauge does not work', 'minor', 'vehicle', 80, 'Note which warning light or gauge is affected.'),
  ('steering.excessive_play', 'steering', 'Steering', 'Excessive play, stiffness or noise in the steering', 'dangerous', 'vehicle', 90, 'With the engine running, turn the wheel; there must be no excessive free play or jamming.'),
  ('horn.inoperative', 'horn', 'Horn', 'Horn does not work', 'minor', 'vehicle', 100, 'Sound the horn; it must work and be within reach.'),
  ('brakes.air_leak', 'brakes_air', 'Brakes and air build-up', 'Audible air leak', 'dangerous', 'both', 110, 'Listen for air leaks with the system charged; pressure must build and hold.'),
  ('brakes.pressure_build', 'brakes_air', 'Brakes and air build-up', 'Air pressure does not build or the warning buzzer stays on', 'dangerous', 'vehicle', 120, 'Watch the gauges while the system charges; the warning must clear.'),
  ('brakes.parking_brake', 'brakes_air', 'Brakes and air build-up', 'Parking brake does not hold', 'dangerous', 'both', 130, 'Apply the parking brake and check the vehicle does not creep.'),
  ('height_marker.missing_wrong', 'height_marker', 'Height marker', 'Height marker missing or showing the wrong height', 'minor', 'vehicle', 140, 'The cab height indicator must show the current running height.'),
  ('seatbelts.faulty', 'seatbelts', 'Seatbelts', 'Seatbelt cut, frayed, or does not latch or retract', 'dangerous', 'vehicle', 150, 'Every seatbelt must be undamaged and latch and retract properly.'),
  ('lights.headlamp', 'lights', 'Lights and indicators', 'Headlamp or sidelamp not working', 'dangerous', 'vehicle', 160, 'Walk round with the lamps on; every lamp must work, show the right colour and have an intact lens.'),
  ('lights.brake_lamp', 'lights', 'Lights and indicators', 'Brake light not working', 'dangerous', 'both', 170, 'Use a reflection or a colleague to check the brake lights.'),
  ('lights.indicator', 'lights', 'Lights and indicators', 'Indicator or hazard light not working', 'dangerous', 'both', 180, 'Switch on the hazard lights and check every indicator flashes.'),
  ('lights.lens_damaged', 'lights', 'Lights and indicators', 'Lamp lens cracked or missing, lamp still works', 'minor', 'both', 190, 'Report any damaged lens so it can be replaced.'),
  ('leaks.fuel', 'fuel_oil_leaks', 'Fuel and oil leaks', 'Fuel leak', 'dangerous', 'vehicle', 200, 'Look under the vehicle and around the tanks with the engine running.'),
  ('leaks.fuel_cap', 'fuel_oil_leaks', 'Fuel and oil leaks', 'Fuel cap missing or not secure', 'dangerous', 'vehicle', 210, 'Every fuel cap must be present and sealed.'),
  ('leaks.oil', 'fuel_oil_leaks', 'Fuel and oil leaks', 'Oil or other fluid dripping onto the road', 'dangerous', 'both', 220, 'Look under the engine, gearbox and axles for drips.'),
  ('battery.insecure', 'battery', 'Battery security and condition', 'Battery insecure or leaking', 'minor', 'vehicle', 230, 'The battery must be held down and show no leaks.'),
  ('adblue.low', 'adblue', 'Diesel exhaust fluid (AdBlue)', 'AdBlue low or warning light on', 'minor', 'vehicle', 240, 'Check the AdBlue level and top up if needed.'),
  ('exhaust.smoke', 'exhaust', 'Excessive engine exhaust smoke', 'Excessive smoke from the exhaust', 'minor', 'vehicle', 250, 'With the engine running, check the exhaust does not give off excessive smoke.'),
  ('body.insecure', 'body_wings', 'Security of body and wings', 'Body panel, wing or fitting loose and likely to fall', 'dangerous', 'both', 260, 'Check doors, panels, wings and fittings are secure.'),
  ('spray.missing', 'spray_suppression', 'Spray suppression', 'Spray suppression flap or mudguard missing or damaged', 'minor', 'both', 270, 'Every wheel must have its mudguard and spray suppression fitted and secure.'),
  ('tyres.tread', 'tyres_wheels', 'Tyres and wheel fixing', 'Tread below 1mm or cords visible', 'dangerous', 'both', 280, 'Check every tyre, including inner twins, for tread depth and exposed cords.'),
  ('tyres.damage', 'tyres_wheels', 'Tyres and wheel fixing', 'Cut, bulge or damage to a tyre', 'dangerous', 'both', 290, 'Look at both sidewalls of every tyre for cuts, bulges and damage.'),
  ('tyres.underinflated', 'tyres_wheels', 'Tyres and wheel fixing', 'Tyre flat or visibly under-inflated', 'dangerous', 'both', 300, 'Every tyre must be visibly inflated; report any that look low.'),
  ('wheels.nut_loose', 'tyres_wheels', 'Tyres and wheel fixing', 'Wheel nut missing or loose, or indicator moved', 'dangerous', 'both', 310, 'Check every wheel nut is present and any wheel nut indicators line up.'),
  ('brake_lines.damaged', 'brake_lines', 'Brake lines', 'Brake line or air hose damaged, chafed or leaking', 'dangerous', 'both', 320, 'Check the air lines and brake hoses for damage and chafing.'),
  ('electrical.connections', 'electrical', 'Electrical connections', 'Trailer electrical connection damaged or insecure', 'dangerous', 'both', 330, 'Every electrical line must be connected, undamaged and not chafing.'),
  ('coupling.insecure', 'coupling', 'Coupling security', 'Fifth wheel or drawbar coupling not locked or secured', 'dangerous', 'both', 340, 'Check the fifth wheel jaw is locked, the safety catch is on and the landing legs are raised.'),
  ('load.insecure', 'load', 'Security of load', 'Load not secured or at risk of shifting', 'dangerous', 'both', 350, 'Check straps, chains, curtains and doors hold the load securely.'),
  ('number_plate.illegible', 'number_plate', 'Number plate', 'Number plate missing, dirty or illegible', 'minor', 'both', 360, 'Every number plate must be present, clean and readable.'),
  ('reflectors.missing', 'reflectors', 'Reflectors', 'Reflector missing, broken or dirty', 'minor', 'both', 370, 'Check the side and rear reflectors are present, clean and unbroken.'),
  ('markings.missing', 'markings', 'Markings and warning plates', 'Required marking or warning plate missing', 'minor', 'both', 380, 'Check rear markings and any hazard warning plates are fitted and correct for the load.')
```

- [ ] **Step 4: Run the drift test, confirm it passes**

Run: `npx vitest run lib/walkaround/baselineSql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/sql/shifts_02_catalogue_seed.sql lib/walkaround/baselineSql.test.ts
git commit -m "Add shifts_02: seed the walkaround baseline, with a drift test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Triggers (`shifts_03_triggers.sql`)

Four database backstops: the baseline cannot be edited, a vehicle with an open dangerous defect cannot leave VOR (`WLK01`), completing a linked maintenance record rectifies the defect, and the existing licence gate (`LIC01`/`LIC02`) covers `shift_vehicle_periods`.

**Files:**
- Create: `docs/sql/shifts_03_triggers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- shifts_03: database backstops for walkaround checks.
--   1. guard_defect_catalogue: nobody edits or deletes the baseline, nobody
--      deletes company items (retire them instead), company rows keep their
--      company and code. errcode WLK03.
--   2. guard_vehicle_return_to_service: vehicles.vor cannot go true -> false
--      while the vehicle has an open dangerous walkaround defect without an
--      approved objection. errcode WLK01. THE CONTRACT with
--      lib/walkaround/vor.ts (RETURN_BLOCKED_MESSAGE, verbatim).
--   3. rectify_walkaround_defect: completing the linked maintenance record
--      sets walkaround_defects.rectified_at.
--   4. gate_vehicle_licensed on shift_vehicle_periods, reusing prodfix_30's
--      function, so an unlicensed or cancelled-company vehicle cannot be taken
--      out on a shift (LIC01 / LIC02).
--
-- Apply after shifts_01 and shifts_02. Safe to re-run.

begin;

create or replace function public.guard_defect_catalogue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.walkaround_seed', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Walkaround checklist items cannot be deleted. Retire the item instead.'
      using errcode = 'WLK03';
  end if;

  if new.company_id is null or (tg_op = 'UPDATE' and old.company_id is null) then
    raise exception 'The baseline walkaround checklist cannot be changed.'
      using errcode = 'WLK03';
  end if;

  if tg_op = 'UPDATE' and (new.company_id is distinct from old.company_id or new.code is distinct from old.code) then
    raise exception 'A checklist item cannot move company or change its code.'
      using errcode = 'WLK03';
  end if;

  return new;
end $$;

drop trigger if exists guard_defect_catalogue on public.defect_catalogue_items;
create trigger guard_defect_catalogue before insert or update or delete on public.defect_catalogue_items
  for each row execute function public.guard_defect_catalogue();

create or replace function public.guard_vehicle_return_to_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.vor is true and new.vor is not true and exists (
    select 1
    from public.walkaround_defects d
    where d.vehicle_id = new.id
      and d.final_severity = 'dangerous'
      and d.rectified_at is null
      and not exists (
        select 1 from public.defect_objections o
        where o.defect_id = d.id and o.status = 'approved'
      )
  ) then
    raise exception 'This vehicle has an open dangerous walkaround defect. Rectify it, or approve the driver''s objection, before returning the vehicle to service.'
      using errcode = 'WLK01', hint = 'walkaround_defect_open';
  end if;
  return new;
end $$;

revoke all on function public.guard_vehicle_return_to_service() from public, anon, authenticated;

drop trigger if exists guard_vehicle_return_to_service on public.vehicles;
create trigger guard_vehicle_return_to_service before update of vor on public.vehicles
  for each row execute function public.guard_vehicle_return_to_service();

create or replace function public.rectify_walkaround_defect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.walkaround_defects
       set rectified_at = now()
     where maintenance_record_id = new.id
       and rectified_at is null;
  end if;
  return new;
end $$;

revoke all on function public.rectify_walkaround_defect() from public, anon, authenticated;

drop trigger if exists rectify_walkaround_defect on public.maintenance_records;
create trigger rectify_walkaround_defect after update of status on public.maintenance_records
  for each row execute function public.rectify_walkaround_defect();

do $$
begin
  if to_regprocedure('public.guard_vehicle_assignment_licensed()') is null then
    raise notice 'shifts_03: prodfix_30 is not applied, shift_vehicle_periods is NOT licence-gated. Re-run shifts_03 after prodfix_30.';
  else
    execute 'drop trigger if exists gate_vehicle_licensed on public.shift_vehicle_periods';
    execute 'create trigger gate_vehicle_licensed before insert or update of vehicle_id on public.shift_vehicle_periods
               for each row execute function public.guard_vehicle_assignment_licensed(''vehicle_id'')';
    raise notice 'shifts_03: gated public.shift_vehicle_periods.vehicle_id';
  end if;
end $$;

commit;

-- ===========================================================================
-- VERIFY
--   select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where t.tgname in ('guard_defect_catalogue','guard_vehicle_return_to_service',
--                      'rectify_walkaround_defect','gate_vehicle_licensed')
--     and not t.tgisinternal order by 1, 2;
--   -- expect defect_catalogue_items, vehicles, maintenance_records and
--   -- shift_vehicle_periods (plus prodfix_30's own gated tables).
```

- [ ] **Step 2: Check `RETURN_BLOCKED_MESSAGE` matches the SQL sentence**

Run: `grep -c "This vehicle has an open dangerous walkaround defect. Rectify it, or approve the driver" docs/sql/shifts_03_triggers.sql lib/walkaround/vor.ts`
Expected: each file `1`. (The SQL doubles the apostrophe in `driver''s`; the TS has `driver's`.)

- [ ] **Step 3: Commit**

```bash
git add docs/sql/shifts_03_triggers.sql
git commit -m "Add shifts_03: baseline guard, WLK01 return-to-service guard, rectification and licence gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Write RPCs (`shifts_04_rpcs.sql`)

Every multi-row write is one plpgsql function so it is atomic, and each is idempotent on the phone's `client_id`. They are SECURITY DEFINER, callable by `service_role` only: the route has already authorized the caller and resolved severities; the RPC trusts its input and only enforces the invariants listed.

**Files:**
- Create: `docs/sql/shifts_04_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- shifts_04: write RPCs for shifts and walkaround checks.
-- Callable by service_role ONLY. The calling route has authorized the driver
-- or office user and resolved every defect's severity with
-- lib/walkaround/severity.ts; these functions make the writes atomic and
-- idempotent on the phone-generated client_id.
--
-- Error codes (the routes map them to HTTP 409):
--   SHF01 a shift is already open        SHF02 no open shift
--   SHF03 a break is already running     SHF04 no break is running
--   SHF05 no vehicle to record end-of-shift defects against
--   WLK02 the vehicle is off the road
--
-- Apply after shifts_01..03. Safe to re-run.

begin;

-- Insert defects for one check, one maintenance record each, and VOR the
-- vehicle if any is dangerous. Returns true when the vehicle was VOR'd.
create or replace function public.walkaround_insert_defects(
  p_tenant uuid, p_check uuid, p_vehicle uuid, p_at timestamptz, p_odometer int,
  p_defects jsonb, p_vor_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb;
  v_mr uuid;
  v_dangerous boolean := false;
begin
  for d in select * from jsonb_array_elements(coalesce(p_defects, '[]'::jsonb)) loop
    insert into public.maintenance_records (tenant_id, vehicle_id, maintenance_type, due_date, status, mileage, notes)
    values (
      p_tenant, p_vehicle,
      left('Walkaround defect: ' || (d->>'label'), 200),
      (p_at at time zone 'Europe/London')::date,
      case when d->>'final_severity' = 'dangerous' then 'vor' else 'due' end,
      p_odometer,
      nullif(d->>'note', '')
    )
    returning id into v_mr;

    insert into public.walkaround_defects (
      tenant_id, check_id, vehicle_id, catalogue_item_id, client_id, label,
      catalogue_severity, final_severity, escalated_by_driver, severity_source, note, maintenance_record_id
    ) values (
      p_tenant, p_check, p_vehicle, nullif(d->>'catalogue_item_id', '')::uuid, (d->>'client_id')::uuid, d->>'label',
      nullif(d->>'catalogue_severity', ''), d->>'final_severity', coalesce((d->>'escalated')::boolean, false),
      d->>'source', nullif(d->>'note', ''), v_mr
    );

    if d->>'final_severity' = 'dangerous' then v_dangerous := true; end if;
  end loop;

  if v_dangerous then
    update public.vehicles
       set vor = true, active = false, vor_since = p_at, vor_reason = p_vor_reason
     where id = p_vehicle and vor is not true;
  end if;

  return v_dangerous;
end $$;

-- A start or swap walkaround check. p keys: tenant_id, driver_id, user_id,
-- client_id, phase ('start'|'swap'), performed_at, vehicle_id, confirmation,
-- mismatch_reason, odometer, previous_end_odometer, result, snapshot (array),
-- flags (text array), vor_reason, defects (array of {client_id,
-- catalogue_item_id, label, catalogue_severity, final_severity, escalated,
-- source, note}).
create or replace function public.walkaround_submit_check(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid := (p->>'tenant_id')::uuid;
  v_driver  uuid := (p->>'driver_id')::uuid;
  v_client  uuid := (p->>'client_id')::uuid;
  v_phase   text := p->>'phase';
  v_at      timestamptz := (p->>'performed_at')::timestamptz;
  v_vehicle uuid := (p->>'vehicle_id')::uuid;
  v_result  text := p->>'result';
  v_flags   text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_existing record;
  v_open    record;
  v_check   uuid;
  v_shift   uuid;
begin
  select id, shift_id, result into v_existing
  from public.walkaround_checks where tenant_id = v_tenant and client_id = v_client;
  if found then
    return jsonb_build_object('duplicate', true, 'check_id', v_existing.id, 'shift_id', v_existing.shift_id, 'result', v_existing.result);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select id into v_open from public.driver_shifts
  where tenant_id = v_tenant and driver_id = v_driver and ended_at is null
  for update;

  if v_phase = 'start' and v_open.id is not null then
    raise exception 'A shift is already open. End it before starting another.' using errcode = 'SHF01';
  end if;
  if v_phase = 'swap' and v_open.id is null then
    raise exception 'There is no open shift to swap vehicles on.' using errcode = 'SHF02';
  end if;
  if exists (select 1 from public.vehicles where id = v_vehicle and vor is true) then
    raise exception 'This vehicle is off the road and cannot be taken out.' using errcode = 'WLK02';
  end if;

  insert into public.walkaround_checks (
    tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
    vehicle_confirmation, vehicle_mismatch_reason, result, checklist_snapshot, declaration_accepted, flags
  ) values (
    v_tenant, v_driver, v_open.id, v_vehicle, v_client, v_phase, v_at, (p->>'odometer')::int,
    p->>'confirmation', nullif(p->>'mismatch_reason', ''), v_result, p->'snapshot', true, v_flags
  ) returning id into v_check;

  perform public.walkaround_insert_defects(v_tenant, v_check, v_vehicle, v_at, (p->>'odometer')::int, p->'defects', p->>'vor_reason');

  if v_phase = 'swap' then
    update public.shift_vehicle_periods
       set ended_at = v_at, end_odometer = (p->>'previous_end_odometer')::int
     where shift_id = v_open.id and ended_at is null;
    v_shift := v_open.id;
  end if;

  if v_result = 'dangerous' then
    return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift, 'result', v_result);
  end if;

  if v_phase = 'start' then
    insert into public.driver_shifts (tenant_id, driver_id, client_id, started_at, flags, created_by_user_id)
    values (v_tenant, v_driver, v_client, v_at, v_flags, nullif(p->>'user_id', '')::uuid)
    returning id into v_shift;
    update public.walkaround_checks set shift_id = v_shift where id = v_check;
  end if;

  insert into public.shift_vehicle_periods (tenant_id, shift_id, vehicle_id, walkaround_check_id, started_at, start_odometer)
  values (v_tenant, v_shift, v_vehicle, v_check, v_at, (p->>'odometer')::int);

  return jsonb_build_object('duplicate', false, 'check_id', v_check, 'shift_id', v_shift, 'result', v_result);
end $$;

-- Break start / break end / shift end. p keys: tenant_id, driver_id, type,
-- client_id, occurred_at, flags; for shift_ended also odometer, and
-- end_check (null, or {client_id, result, snapshot, vor_reason, defects}).
create or replace function public.shift_record_event(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_driver uuid := (p->>'driver_id')::uuid;
  v_type   text := p->>'type';
  v_client uuid := (p->>'client_id')::uuid;
  v_at     timestamptz := (p->>'occurred_at')::timestamptz;
  v_flags  text[] := coalesce(array(select jsonb_array_elements_text(p->'flags')), '{}');
  v_shift  record;
  v_break  record;
  v_period record;
  v_check  uuid;
  v_end    jsonb := p->'end_check';
  v_has_defects boolean := jsonb_array_length(coalesce(p->'end_check'->'defects', '[]'::jsonb)) > 0;
begin
  if v_type = 'break_started' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  elsif v_type = 'break_ended' then
    if exists (select 1 from public.shift_breaks where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  elsif v_type = 'shift_ended' then
    if exists (select 1 from public.driver_shifts where tenant_id = v_tenant and end_client_id = v_client) then
      return jsonb_build_object('duplicate', true);
    end if;
  else
    raise exception 'Unknown shift event type %', v_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));

  select * into v_shift from public.driver_shifts
  where tenant_id = v_tenant and driver_id = v_driver and ended_at is null
  for update;

  if v_type = 'break_started' then
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    if exists (select 1 from public.shift_breaks where shift_id = v_shift.id and ended_at is null) then
      raise exception 'A break is already running.' using errcode = 'SHF03';
    end if;
    insert into public.shift_breaks (tenant_id, shift_id, client_id, started_at, flags)
    values (v_tenant, v_shift.id, v_client, v_at, v_flags);
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  if v_type = 'break_ended' then
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    update public.shift_breaks
       set ended_at = v_at, end_client_id = v_client, end_received_at = now(), flags = flags || v_flags
     where shift_id = v_shift.id and ended_at is null;
    if not found then raise exception 'No break is running.' using errcode = 'SHF04'; end if;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id);
  end if;

  -- shift_ended. If the office already ended this driver's shift, attach the
  -- driver's end to it (flagged) instead of overriding the office correction.
  if v_shift.id is null then
    select * into v_shift from public.driver_shifts
    where tenant_id = v_tenant and driver_id = v_driver and ended_by = 'office' and end_client_id is null
    order by started_at desc limit 1
    for update;
    if v_shift.id is null then raise exception 'There is no open shift.' using errcode = 'SHF02'; end if;
    v_flags := v_flags || array['driver_end_after_office'];
  end if;

  select * into v_period from public.shift_vehicle_periods
  where shift_id = v_shift.id order by started_at desc limit 1;

  if v_has_defects then
    if v_period.id is null then
      raise exception 'There is no vehicle on this shift to record defects against.' using errcode = 'SHF05';
    end if;
    insert into public.walkaround_checks (
      tenant_id, driver_id, shift_id, vehicle_id, client_id, phase, performed_at, odometer,
      vehicle_confirmation, result, checklist_snapshot, declaration_accepted, flags
    ) values (
      v_tenant, v_driver, v_shift.id, v_period.vehicle_id, (v_end->>'client_id')::uuid, 'end_of_shift', v_at,
      (p->>'odometer')::int, 'none', v_end->>'result', v_end->'snapshot', true, v_flags
    ) returning id into v_check;
    perform public.walkaround_insert_defects(v_tenant, v_check, v_period.vehicle_id, v_at, (p->>'odometer')::int, v_end->'defects', v_end->>'vor_reason');
  end if;

  if 'driver_end_after_office' = any(v_flags) then
    update public.driver_shifts
       set end_client_id = v_client, flags = flags || v_flags,
           end_defect_answer = case when v_has_defects then 'reported' else 'none' end
     where id = v_shift.id;
    return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'attached', true);
  end if;

  update public.shift_breaks set ended_at = v_at, end_received_at = now()
   where shift_id = v_shift.id and ended_at is null;
  update public.shift_vehicle_periods set ended_at = v_at, end_odometer = (p->>'odometer')::int
   where shift_id = v_shift.id and ended_at is null;
  update public.driver_shifts
     set ended_at = v_at, end_client_id = v_client, end_received_at = now(), ended_by = 'driver',
         end_defect_answer = case when v_has_defects then 'reported' else 'none' end,
         flags = flags || v_flags
   where id = v_shift.id;

  return jsonb_build_object('duplicate', false, 'shift_id', v_shift.id, 'attached', false);
end $$;

-- Office correction to a shift's start or end, with an audit row.
-- p keys: tenant_id, shift_id, user_id, field ('started_at'|'ended_at'), value, reason.
create or replace function public.shift_apply_correction(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_field text := p->>'field';
  v_value timestamptz := (p->>'value')::timestamptz;
  v_old   timestamptz;
begin
  select * into v_shift from public.driver_shifts
  where id = (p->>'shift_id')::uuid and tenant_id = (p->>'tenant_id')::uuid
  for update;
  if v_shift.id is null then raise exception 'Shift not found.' using errcode = 'SHF02'; end if;

  if v_field = 'started_at' then
    v_old := v_shift.started_at;
    update public.driver_shifts set started_at = v_value where id = v_shift.id;
  elsif v_field = 'ended_at' then
    v_old := v_shift.ended_at;
    update public.driver_shifts
       set ended_at = v_value,
           ended_by = case when v_shift.ended_at is null then 'office' else ended_by end
     where id = v_shift.id;
    update public.shift_breaks set ended_at = v_value where shift_id = v_shift.id and ended_at is null;
    update public.shift_vehicle_periods set ended_at = v_value where shift_id = v_shift.id and ended_at is null;
  else
    raise exception 'Only the start or end of a shift can be corrected.';
  end if;

  insert into public.shift_corrections (tenant_id, shift_id, corrected_by_user_id, field, old_value, new_value, reason)
  values (v_shift.tenant_id, v_shift.id, (p->>'user_id')::uuid, v_field, v_old::text, v_value::text, p->>'reason');

  return jsonb_build_object('shift_id', v_shift.id);
end $$;

-- Office starts a shift for a driver whose phone is unavailable. Hours only:
-- no vehicle period, so the job gate still blocks stop completion.
-- p keys: tenant_id, driver_id, user_id, started_at, reason.
create or replace function public.shift_office_start(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_driver uuid := (p->>'driver_id')::uuid;
  v_shift  uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('driver_shift:' || v_driver::text, 0));
  if exists (select 1 from public.driver_shifts where driver_id = v_driver and ended_at is null) then
    raise exception 'This driver already has an open shift.' using errcode = 'SHF01';
  end if;
  insert into public.driver_shifts (tenant_id, driver_id, client_id, started_at, flags, created_by_user_id)
  values (v_tenant, v_driver, gen_random_uuid(), (p->>'started_at')::timestamptz, array['office_started'], (p->>'user_id')::uuid)
  returning id into v_shift;
  insert into public.shift_corrections (tenant_id, shift_id, corrected_by_user_id, field, old_value, new_value, reason)
  values (v_tenant, v_shift, (p->>'user_id')::uuid, 'office_started', null, p->>'started_at', p->>'reason');
  return jsonb_build_object('shift_id', v_shift);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.walkaround_insert_defects(uuid, uuid, uuid, timestamptz, int, jsonb, text)',
    'public.walkaround_submit_check(jsonb)',
    'public.shift_record_event(jsonb)',
    'public.shift_apply_correction(jsonb)',
    'public.shift_office_start(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

-- VERIFY: nobody but service_role (and the owner) may execute.
--   select p.proname, r.rolname
--   from pg_proc p cross join pg_roles r
--   where p.proname in ('walkaround_insert_defects','walkaround_submit_check','shift_record_event',
--                       'shift_apply_correction','shift_office_start')
--     and r.rolname in ('anon','authenticated','service_role')
--     and has_function_privilege(r.oid, p.oid, 'execute');
--   -- expect only service_role rows.
```

- [ ] **Step 2: Check no em-dashes and balanced transaction**

Run: `grep -cP "\x{2014}" docs/sql/shifts_04_rpcs.sql; grep -c "^begin;" docs/sql/shifts_04_rpcs.sql; grep -c "^commit;" docs/sql/shifts_04_rpcs.sql`
Expected: `0`, `1`, `1`.

- [ ] **Step 3: Commit**

```bash
git add docs/sql/shifts_04_rpcs.sql
git commit -m "Add shifts_04: atomic, idempotent write RPCs for shifts and checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Storage bucket, verify script and apply order

**Files:**
- Create: `docs/sql/shifts_05_storage.sql`, `docs/sql/shifts_verify.sql`
- Modify: `docs/sql/prodfix_00_APPLY_ORDER.md` (append a section)

- [ ] **Step 1: Write `docs/sql/shifts_05_storage.sql`**

```sql
-- shifts_05: private bucket for walkaround defect photos.
-- Path rule: <tenant_id>/<check_id>/<defect_client_id>/<file>.
-- Deliberately NO storage.objects policies: the browser neither reads nor
-- writes this bucket directly. Uploads use server-issued signed upload URLs and
-- reads use short-lived signed URLs, both minted by route handlers after
-- authorization (same model as pod-files uploads).
-- Safe to re-run.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('walkaround-photos', 'walkaround-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

-- VERIFY: expect public = false and no policy mentioning the bucket.
--   select id, public, file_size_limit from storage.buckets where id = 'walkaround-photos';
--   select policyname from pg_policies where schemaname = 'storage'
--     and (coalesce(qual,'') like '%walkaround-photos%' or coalesce(with_check,'') like '%walkaround-photos%');
```

- [ ] **Step 2: Write `docs/sql/shifts_verify.sql`**

```sql
-- shifts_verify: read-only checks for shifts_01..05. Changes nothing.

-- 1. RLS on, expect nine rows all true.
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                  'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings')
order by 1;

-- 2. Client roles hold SELECT only. Expect zero rows.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in ('driver_shifts','shift_breaks','walkaround_checks','shift_vehicle_periods','walkaround_defects',
                     'defect_objections','shift_corrections','defect_catalogue_items','walkaround_settings')
  and not (grantee = 'authenticated' and privilege_type = 'SELECT');

-- 3. Baseline seeded. Expect 38 total, 24 dangerous.
select count(*) as baseline, count(*) filter (where severity = 'dangerous') as dangerous
from public.defect_catalogue_items where company_id is null;

-- 4. Triggers installed. Expect four rows (gate_vehicle_licensed only if prodfix_30 is applied).
select c.relname, t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and (t.tgname in ('guard_defect_catalogue', 'guard_vehicle_return_to_service', 'rectify_walkaround_defect')
       or (t.tgname = 'gate_vehicle_licensed' and c.relname = 'shift_vehicle_periods'))
order by 1;

-- 5. RPCs executable by service_role only. Expect only service_role rows.
select p.proname, r.rolname
from pg_proc p cross join pg_roles r
where p.proname in ('walkaround_insert_defects','walkaround_submit_check','shift_record_event',
                    'shift_apply_correction','shift_office_start')
  and r.rolname in ('anon', 'authenticated', 'service_role')
  and has_function_privilege(r.oid, p.oid, 'execute')
order by 1, 2;

-- 6. Photo bucket private. Expect one row, public = false.
select id, public from storage.buckets where id = 'walkaround-photos';
```

- [ ] **Step 3: Append the apply-order section** to the end of `docs/sql/prodfix_00_APPLY_ORDER.md`

```markdown
## Driver shifts and walkaround checks (shifts_01..05), 2026-09-29

Spec: `docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md`. Apply in this order, then run
`shifts_verify.sql`. **Apply before inviting the first driver**: until these exist, the job gate in the
driver stop routes fails closed and no driver can complete a stop.

| Order | File | Needs | Applied |
|---|---|---|---|
| 1 | `shifts_01_tables.sql` | rls_02 | no |
| 2 | `shifts_02_catalogue_seed.sql` | shifts_01 | no |
| 3 | `shifts_03_triggers.sql` | shifts_02; re-run after prodfix_30 if that is applied later | no |
| 4 | `shifts_04_rpcs.sql` | shifts_03 | no |
| 5 | `shifts_05_storage.sql` | none | no |
| check | `shifts_verify.sql` | all of the above | |
```

- [ ] **Step 4: Commit**

```bash
git add docs/sql/shifts_05_storage.sql docs/sql/shifts_verify.sql docs/sql/prodfix_00_APPLY_ORDER.md
git commit -m "Add shifts_05 photo bucket, the verify script and the apply order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase C: server

Route handler conventions in this repo (copy them): `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`, dynamic params are a `Promise` (`const { id } = await context.params;`), ids validated with `isUuid` from `lib/auth/serverTenantAccess.ts` before any query, errors answered as `NextResponse.json({ error: message }, { status })`. Driver routes wrap everything in `try { ... } catch (error) { const { status, message } = driverErrorResponse(error); return NextResponse.json({ error: message }, { status }); }` exactly as `app/api/driver/me/route.ts` does. Read `app/api/driver/me/route.ts` and `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url/route.ts` before Task 17.

### Task 17: Server loaders (`lib/walkaround/server.ts`)

**Files:**
- Create: `lib/driver/operatorTimeZone.ts` (moved out of the `me` route so two routes can share it)
- Modify: `app/api/driver/me/route.ts` (import the moved function; delete its local copy)
- Create: `lib/walkaround/server.ts`

- [ ] **Step 1: Move `loadOperatorTimeZone`**

Create `lib/driver/operatorTimeZone.ts` containing the exact body of `loadOperatorTimeZone` from `app/api/driver/me/route.ts:100-129`, exported, typed on `SupabaseClient` instead of `ReturnType<typeof createAdminClient>`, plus a sibling that also returns the company name:

```ts
/*
  The operator's time zone and display name for a driver's tenant. Server-only
  (takes the service-role client). company_profiles is keyed by the COMPANY id
  in its tenant_id column.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPERATOR_TIME_ZONE, isValidIanaTimeZone } from "../time";

export type OperatorProfile = { companyId: string | null; timeZone: string; companyName: string | null };

export async function loadOperatorProfile(admin: SupabaseClient, tenantId: string): Promise<OperatorProfile> {
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("company_id").eq("id", tenantId).maybeSingle();
  if (tenantError || !tenant?.company_id) return { companyId: null, timeZone: OPERATOR_TIME_ZONE, companyName: null };

  const companyId = String(tenant.company_id);
  const { data: profile, error: profileError } = await admin
    .from("company_profiles")
    .select("timezone, company_name, trading_name")
    .eq("tenant_id", companyId)
    .maybeSingle();

  if (profileError) {
    console.warn("[driver] company profile lookup failed", profileError.code);
    return { companyId, timeZone: OPERATOR_TIME_ZONE, companyName: null };
  }

  const candidate = typeof profile?.timezone === "string" ? profile.timezone.trim() : "";
  const name = [profile?.trading_name, profile?.company_name].find((v) => typeof v === "string" && v.trim());
  return {
    companyId,
    timeZone: candidate && isValidIanaTimeZone(candidate) ? candidate : OPERATOR_TIME_ZONE,
    companyName: typeof name === "string" ? name.trim() : null,
  };
}

export async function loadOperatorTimeZone(admin: SupabaseClient, tenantId: string): Promise<string> {
  return (await loadOperatorProfile(admin, tenantId)).timeZone;
}
```

In `app/api/driver/me/route.ts`: delete the local `loadOperatorTimeZone` function, add `import { loadOperatorTimeZone } from "../../../../lib/driver/operatorTimeZone";`, and remove the now-unused `OPERATOR_TIME_ZONE`/`isValidIanaTimeZone` imports. Behaviour is unchanged.

- [ ] **Step 2: Run the suite and typecheck to prove the move changed nothing**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Write `lib/walkaround/server.ts`**

```ts
/*
  Server-only loaders for driver shifts and walkaround checks. Every function
  takes the service-role client, so every query is filtered by the tenant and
  driver the caller was already authorized for. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DriverAccessError, requireDriverSession, type DriverSession } from "../driver/server";
import { loadOperatorProfile } from "../driver/operatorTimeZone";
import { operatorDayInTimeZone } from "../time";
import { activeCatalogue } from "./catalogue";
import type { DriverDefectView, DriverShiftState } from "./driverState";
import { jobGateDecision, type JobGateInput } from "./jobGate";
import { dangerReason } from "./severity";
import type { CatalogueItem, CheckResult, ObjectionStatus, Severity, SeveritySource } from "./types";

export async function requireDirectDriver(options: { jobId?: string } = {}): Promise<DriverSession> {
  const session = await requireDriverSession(options);
  if (session.portalType !== "direct_driver") {
    throw new DriverAccessError("Shifts and walkaround checks are for your own fleet's drivers.", 403);
  }
  return session;
}

const CATALOGUE_SELECT = "id,company_id,code,category,item_label,defect_label,guidance,severity,applies_to,sort_order,retired_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCatalogueItem(row: any): CatalogueItem {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : null,
    code: String(row.code),
    category: String(row.category),
    itemLabel: String(row.item_label),
    defectLabel: String(row.defect_label),
    guidance: String(row.guidance ?? ""),
    severity: row.severity === "dangerous" ? "dangerous" : "minor",
    appliesTo: row.applies_to === "trailer" || row.applies_to === "both" ? row.applies_to : "vehicle",
    sortOrder: Number(row.sort_order ?? 0),
    retiredAt: row.retired_at ? String(row.retired_at) : null,
  };
}

/** Baseline plus this company's rows, INCLUDING retired ones (severity needs to see them to refuse them). */
export async function loadCatalogueRows(admin: SupabaseClient, companyId: string): Promise<CatalogueItem[]> {
  const { data, error } = await admin
    .from("defect_catalogue_items")
    .select(CATALOGUE_SELECT)
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toCatalogueItem);
}

export type TenantVehicle = { id: string; registration: string; vor: boolean; active: boolean; qrTokenHash: string | null };

/** vehicles has no company_id; some legacy rows carry the company id in tenant_id, so both are read. */
export async function loadTenantVehicles(admin: SupabaseClient, tenantId: string, companyId: string | null): Promise<TenantVehicle[]> {
  const keys = [...new Set([tenantId, companyId].filter((v): v is string => Boolean(v)))];
  const { data, error } = await admin
    .from("vehicles")
    .select("id,registration,vor,active,walkaround_qr_token_hash")
    .in("tenant_id", keys);
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({
    id: String(v.id),
    registration: String(v.registration ?? "").trim() || "Unregistered",
    vor: v.vor === true,
    active: v.active !== false,
    qrTokenHash: v.walkaround_qr_token_hash ? String(v.walkaround_qr_token_hash) : null,
  }));
}

export async function loadAssignedVehicleId(admin: SupabaseClient, session: DriverSession, today: string): Promise<string | null> {
  const { data: assignment, error } = await admin
    .from("vehicle_assignments")
    .select("vehicle_id")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .eq("active", true)
    .not("vehicle_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (assignment?.vehicle_id) return String(assignment.vehicle_id);

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("vehicle_id")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .or(`scheduled_date.eq.${today},and(scheduled_date.is.null,job_date.eq.${today})`)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  return job?.vehicle_id ? String(job.vehicle_id) : null;
}

export type OpenShiftRows = {
  shift: { id: string; startedAt: string; flags: string[] } | null;
  breaks: { startedAt: string; endedAt: string | null }[];
  period: { id: string; vehicleId: string; startOdometer: number; checkResult: CheckResult | null; vehicleVor: boolean } | null;
};

export async function loadOpenShift(admin: SupabaseClient, session: DriverSession): Promise<OpenShiftRows> {
  const { data: shift, error } = await admin
    .from("driver_shifts")
    .select("id,started_at,flags")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shift) return { shift: null, breaks: [], period: null };

  const [breaksResult, periodResult] = await Promise.all([
    admin.from("shift_breaks").select("started_at,ended_at").eq("shift_id", shift.id).order("started_at"),
    admin
      .from("shift_vehicle_periods")
      .select("id,vehicle_id,start_odometer,walkaround_check_id")
      .eq("shift_id", shift.id)
      .is("ended_at", null)
      .maybeSingle(),
  ]);
  if (breaksResult.error) throw new Error(breaksResult.error.message);
  if (periodResult.error) throw new Error(periodResult.error.message);

  let period: OpenShiftRows["period"] = null;
  if (periodResult.data) {
    const p = periodResult.data;
    const [checkResult, vehicleResult] = await Promise.all([
      admin.from("walkaround_checks").select("result").eq("id", p.walkaround_check_id).maybeSingle(),
      admin.from("vehicles").select("vor").eq("id", p.vehicle_id).maybeSingle(),
    ]);
    if (checkResult.error) throw new Error(checkResult.error.message);
    if (vehicleResult.error) throw new Error(vehicleResult.error.message);
    period = {
      id: String(p.id),
      vehicleId: String(p.vehicle_id),
      startOdometer: Number(p.start_odometer),
      checkResult: (checkResult.data?.result as CheckResult | undefined) ?? null,
      vehicleVor: vehicleResult.data?.vor === true,
    };
  }

  return {
    shift: { id: String(shift.id), startedAt: String(shift.started_at), flags: (shift.flags as string[]) ?? [] },
    breaks: (breaksResult.data ?? []).map((b) => ({ startedAt: String(b.started_at), endedAt: b.ended_at ? String(b.ended_at) : null })),
    period,
  };
}

export async function loadJobGateInput(admin: SupabaseClient, session: DriverSession): Promise<JobGateInput> {
  if (session.portalType !== "direct_driver") return { portalType: session.portalType, openShift: null };
  const open = await loadOpenShift(admin, session);
  return {
    portalType: session.portalType,
    openShift: open.shift
      ? { currentPeriod: open.period ? { vehicleId: open.period.vehicleId, checkResult: open.period.checkResult, vehicleVor: open.period.vehicleVor } : null }
      : null,
  };
}

/**
  The job gate for stop completion and POD routes. Returns a 409 response when
  the driver may not work, or null. FAILS CLOSED: if the shift tables are
  missing (SQL not applied yet) or a lookup fails, the driver is refused.
*/
export async function jobGateResponse(admin: SupabaseClient, session: DriverSession): Promise<NextResponse | null> {
  if (session.portalType !== "direct_driver") return null;
  let input: JobGateInput;
  try {
    input = await loadJobGateInput(admin, session);
  } catch (error) {
    console.error("[walkaround] job gate lookup failed", error);
    return NextResponse.json({ error: "Walkaround checks are not available right now, so jobs cannot be completed. Ask the office." }, { status: 409 });
  }
  const decision = jobGateDecision(input);
  return decision.ok ? null : NextResponse.json({ error: decision.message }, { status: 409 });
}

type DefectRow = {
  id: string;
  client_id: string;
  label: string;
  final_severity: Severity;
  severity_source: SeveritySource;
  note: string | null;
  photo_paths: string[] | null;
  catalogue_item_id: string | null;
};

export async function defectViews(
  admin: SupabaseClient,
  checkId: string,
  catalogue: ReadonlyMap<string, CatalogueItem>,
  companyName: string | null,
): Promise<DriverDefectView[]> {
  const { data, error } = await admin
    .from("walkaround_defects")
    .select("id,client_id,label,final_severity,severity_source,note,photo_paths,catalogue_item_id")
    .eq("check_id", checkId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DefectRow[];
  if (rows.length === 0) return [];

  const { data: objections, error: objectionError } = await admin
    .from("defect_objections")
    .select("defect_id,status,decision_note,raised_at")
    .in("defect_id", rows.map((r) => r.id))
    .order("raised_at", { ascending: false });
  if (objectionError) throw new Error(objectionError.message);

  return rows.map((r) => {
    const latest = (objections ?? []).find((o) => o.defect_id === r.id);
    return {
      clientId: String(r.client_id),
      label: r.label,
      finalSeverity: r.final_severity,
      severitySource: r.severity_source,
      reason: dangerReason({ finalSeverity: r.final_severity, severitySource: r.severity_source }, companyName),
      guidance: r.catalogue_item_id ? catalogue.get(r.catalogue_item_id)?.guidance ?? null : null,
      note: r.note,
      photoCount: r.photo_paths?.length ?? 0,
      objection: latest ? { status: latest.status as ObjectionStatus, decisionNote: latest.decision_note ?? null } : null,
    };
  });
}

export async function loadDriverShiftState(admin: SupabaseClient, session: DriverSession): Promise<DriverShiftState> {
  const operator = await loadOperatorProfile(admin, session.tenantId);
  const companyId = operator.companyId ?? session.tenantId;
  const today = operatorDayInTimeZone(new Date(), operator.timeZone);

  const [catalogueRows, vehicles, assignedId, open, settings] = await Promise.all([
    loadCatalogueRows(admin, companyId),
    loadTenantVehicles(admin, session.tenantId, operator.companyId),
    loadAssignedVehicleId(admin, session, today),
    loadOpenShift(admin, session),
    admin.from("walkaround_settings").select("on_call_phone").eq("company_id", companyId).maybeSingle(),
  ]);
  if (settings.error) throw new Error(settings.error.message);

  const catalogueMap = new Map(catalogueRows.map((i) => [i.id, i]));
  const registration = (id: string) => vehicles.find((v) => v.id === id)?.registration ?? "Vehicle";
  const assigned = assignedId ? vehicles.find((v) => v.id === assignedId) ?? null : null;

  // The most recent dangerous start/swap check today that is not followed by
  // a later passing check: the driver still needs to see why they were stopped.
  const { data: recent, error: recentError } = await admin
    .from("walkaround_checks")
    .select("id,client_id,vehicle_id,performed_at,result,phase")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .in("phase", ["start", "swap"])
    .order("performed_at", { ascending: false })
    .limit(1);
  if (recentError) throw new Error(recentError.message);
  const last = recent?.[0];
  const lastIsToday = last ? operatorDayInTimeZone(new Date(String(last.performed_at)), operator.timeZone) === today : false;

  let blockingCheck: DriverShiftState["blockingCheck"] = null;
  if (last && lastIsToday && last.result === "dangerous") {
    blockingCheck = {
      checkClientId: String(last.client_id),
      vehicleId: String(last.vehicle_id),
      registration: registration(String(last.vehicle_id)),
      performedAt: String(last.performed_at),
      defects: await defectViews(admin, String(last.id), catalogueMap, operator.companyName),
    };
  }

  return {
    today,
    companyName: operator.companyName,
    onCallPhone: settings.data?.on_call_phone ? String(settings.data.on_call_phone) : null,
    assignedVehicle: assigned ? { id: assigned.id, registration: assigned.registration } : null,
    vehicles: vehicles.filter((v) => v.active || v.vor).map((v) => ({ id: v.id, registration: v.registration, vor: v.vor })),
    catalogue: activeCatalogue(catalogueRows, companyId),
    openShift: open.shift
      ? {
          id: open.shift.id,
          startedAt: open.shift.startedAt,
          onBreak: open.breaks.some((b) => b.endedAt === null),
          breaks: open.breaks,
          currentVehicle: open.period && open.period.checkResult && open.period.checkResult !== "dangerous"
            ? { vehicleId: open.period.vehicleId, registration: registration(open.period.vehicleId), startOdometer: open.period.startOdometer, checkResult: open.period.checkResult }
            : null,
        }
      : null,
    blockingCheck,
    syncPending: false,
  };
}

/** Map an RPC error to an HTTP answer. Known business refusals are 409 with the database's sentence. */
export function rpcErrorResponse(error: { code?: string; message?: string } | null): NextResponse {
  const code = error?.code ?? "";
  if (["SHF01", "SHF02", "SHF03", "SHF04", "SHF05", "WLK02", "LIC01", "LIC02"].includes(code)) {
    return NextResponse.json({ error: error?.message ?? "Refused." }, { status: 409 });
  }
  console.error("[walkaround] rpc failed", code, error?.message);
  return NextResponse.json({ error: "Unable to save. Try again." }, { status: 500 });
}
```

Note on `rpcErrorResponse`: for `LIC01` / `LIC02` the database message is already the user sentence (see `lib/billing/unlicensedVehicle.ts`), so it is passed through as-is.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. (There is no vitest coverage for this file: it only queries. The rules it feeds are covered in Tasks 1 to 11.)

- [ ] **Step 5: Commit**

```bash
git add lib/driver/operatorTimeZone.ts app/api/driver/me/route.ts lib/walkaround/server.ts
git commit -m "Add server loaders for driver shifts and walkaround checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Driver event processing and the driver routes

**Files:**
- Create: `lib/walkaround/processEvent.ts`
- Create: `app/api/driver/shift/route.ts`, `app/api/driver/shift/events/route.ts`
- Create: `app/api/driver/walkaround/photos/upload-url/route.ts`, `app/api/driver/walkaround/photos/route.ts`
- Modify: `lib/auth/routeClassification.test.ts` (add the four routes to the protected list, alphabetical position next to the other `/api/driver/...` entries)

- [ ] **Step 1: Add the four routes to `lib/auth/routeClassification.test.ts` and run it to see it fail**

Add to the protected list:
```ts
  "/api/driver/shift",
  "/api/driver/shift/events",
  "/api/driver/walkaround/photos",
  "/api/driver/walkaround/photos/upload-url",
```
Run: `npx vitest run lib/auth/routeClassification.test.ts`
Expected: FAIL (listed routes do not exist yet).

- [ ] **Step 2: Write `lib/walkaround/processEvent.ts`**

```ts
/*
  Apply one queued driver event (lib/shifts/events.ts). Server-only.
  The phone is never trusted for severity, vehicle identity or time sanity:
  each is recomputed here before the RPC in shifts_04 writes atomically.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverSession } from "../driver/server";
import { loadOperatorProfile } from "../driver/operatorTimeZone";
import { operatorDayInTimeZone } from "../time";
import { hashQrToken } from "./qrTokenServer";
import { parseQrPayload, registrationsMatch } from "./qrToken";
import { toSnapshot } from "./catalogue";
import { checkResult, resolveDefect, type ResolvedDefect } from "./severity";
import { vorReasonForDefects } from "./vor";
import { loadAssignedVehicleId, loadCatalogueRows, loadOpenShift, loadTenantVehicles } from "./server";
import { occurrenceCheck, type EventFlag } from "../shifts/syncRules";
import { validateBreakEnd, validateBreakStart } from "../shifts/hours";
import type { CheckSubmittedEvent, DriverEvent, QueuedDefect } from "../shifts/events";
import type { CatalogueItem } from "./types";

export type ProcessResult = { status: number; body: Record<string, unknown> };

const refuse = (status: number, error: string): ProcessResult => ({ status, body: { error } });

function rpcDefects(resolved: readonly ResolvedDefect[]) {
  return resolved.map((d) => ({
    client_id: d.clientId,
    catalogue_item_id: d.catalogueItemId,
    label: d.label,
    catalogue_severity: d.catalogueSeverity,
    final_severity: d.finalSeverity,
    escalated: d.escalatedByDriver,
    source: d.severitySource,
    note: d.note,
  }));
}

function resolveAll(
  defects: readonly QueuedDefect[],
  catalogue: ReadonlyMap<string, CatalogueItem>,
): { ok: true; value: ResolvedDefect[] } | { ok: false; error: string } {
  const out: ResolvedDefect[] = [];
  for (const d of defects) {
    const r = resolveDefect(d, catalogue);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

function rpcError(error: { code?: string; message?: string }): ProcessResult {
  const known = ["SHF01", "SHF02", "SHF03", "SHF04", "SHF05", "WLK02", "LIC01", "LIC02"];
  if (known.includes(error.code ?? "")) return refuse(409, error.message ?? "Refused.");
  console.error("[walkaround] rpc failed", error.code, error.message);
  return refuse(500, "Unable to save. Try again.");
}

async function processCheck(admin: SupabaseClient, session: DriverSession, event: CheckSubmittedEvent, receivedAt: Date): Promise<ProcessResult> {
  const operator = await loadOperatorProfile(admin, session.tenantId);
  const companyId = operator.companyId ?? session.tenantId;
  const [vehicles, open, catalogueRows] = await Promise.all([
    loadTenantVehicles(admin, session.tenantId, operator.companyId),
    loadOpenShift(admin, session),
    loadCatalogueRows(admin, companyId),
  ]);

  const previous = open.shift ? [open.shift.startedAt, ...open.breaks.flatMap((b) => [b.startedAt, b.endedAt ?? b.startedAt])].sort().at(-1) ?? null : null;
  const timing = occurrenceCheck({ occurredAt: event.occurredAt, receivedAt, previousOccurredAt: previous });
  if (!timing.ok) return refuse(400, timing.error);
  const flags: string[] = [...timing.flags];

  const vehicle = vehicles.find((v) => v.id === event.vehicleId);
  if (!vehicle) return refuse(404, "That vehicle is not in your fleet.");
  if (vehicle.vor) return refuse(409, `${vehicle.registration} is off the road and cannot be taken out.`);
  if (!vehicle.active) return refuse(409, `${vehicle.registration} is not active. Ask the office.`);

  if (event.confirmation === "qr") {
    const token = parseQrPayload(event.qrPayload ?? "");
    if (!token || !vehicle.qrTokenHash || hashQrToken(token) !== vehicle.qrTokenHash) {
      return refuse(409, "That QR code is not for this vehicle. It may have been reissued. Type the registration instead.");
    }
  } else if (!registrationsMatch(event.typedRegistration ?? "", vehicle.registration)) {
    return refuse(409, `The registration you typed does not match ${vehicle.registration}.`);
  }

  const today = operatorDayInTimeZone(new Date(event.occurredAt), operator.timeZone);
  const assignedId = await loadAssignedVehicleId(admin, session, today);
  if (assignedId && assignedId !== vehicle.id) {
    if (!event.mismatchReason?.trim()) return refuse(400, "Say why you are taking a different vehicle.");
    flags.push("assigned_vehicle_mismatch");
  }

  // Every checklist item the phone showed must still exist, belong to this
  // company or the baseline, and not be retired.
  const catalogue = new Map(catalogueRows.map((i) => [i.id, i]));
  const shown: CatalogueItem[] = [];
  for (const id of event.checklistItemIds) {
    const item = catalogue.get(id);
    if (!item || item.retiredAt !== null) return refuse(409, "The checklist has changed. Reload the check and try again.");
    shown.push(item);
  }

  const resolved = resolveAll(event.defects, catalogue);
  if (!resolved.ok) return refuse(400, resolved.error);
  // The phone cannot downgrade; log any attempt (spec: a mismatch is logged).
  if (resolved.value.some((d) => d.finalSeverity === "dangerous" && event.defects.find((x) => x.clientId === d.clientId)?.driverSeverity === "minor")) {
    console.warn("[walkaround] phone tried to lower a dangerous defect", session.driverId);
  }

  const result = checkResult(resolved.value);
  const dangerousLabels = resolved.value.filter((d) => d.finalSeverity === "dangerous").map((d) => d.label);

  const { data, error } = await admin.rpc("walkaround_submit_check", {
    p: {
      tenant_id: session.tenantId,
      driver_id: session.driverId,
      user_id: session.userId,
      client_id: event.clientId,
      phase: event.phase,
      performed_at: event.occurredAt,
      vehicle_id: vehicle.id,
      confirmation: event.confirmation,
      mismatch_reason: event.mismatchReason?.trim() || null,
      odometer: event.odometer,
      previous_end_odometer: event.previousEndOdometer,
      result,
      snapshot: toSnapshot(shown),
      flags,
      vor_reason: dangerousLabels.length ? vorReasonForDefects(dangerousLabels) : null,
      defects: rpcDefects(resolved.value),
    },
  });
  if (error) return rpcError(error);
  return { status: 200, body: { ok: true, ...(data as Record<string, unknown>) } };
}

async function processShiftEvent(admin: SupabaseClient, session: DriverSession, event: Exclude<DriverEvent, CheckSubmittedEvent | { type: "objection_raised" }>, receivedAt: Date): Promise<ProcessResult> {
  const open = await loadOpenShift(admin, session);
  const previous = open.shift ? [open.shift.startedAt, ...open.breaks.flatMap((b) => [b.startedAt, b.endedAt ?? b.startedAt])].sort().at(-1) ?? null : null;
  const timing = occurrenceCheck({ occurredAt: event.occurredAt, receivedAt, previousOccurredAt: previous });
  if (!timing.ok) return refuse(400, timing.error);
  const flags: EventFlag[] = timing.flags;

  if (open.shift && event.type === "break_started") {
    const v = validateBreakStart({ startedAt: open.shift.startedAt, endedAt: null, breaks: open.breaks }, event.occurredAt);
    if (!v.ok) return refuse(409, v.error);
  }
  if (open.shift && event.type === "break_ended") {
    const v = validateBreakEnd(open.breaks.find((b) => b.endedAt === null) ?? null, event.occurredAt);
    if (!v.ok) return refuse(409, v.error);
  }

  let endCheck: Record<string, unknown> | null = null;
  if (event.type === "shift_ended" && event.newDefects.length > 0) {
    const operator = await loadOperatorProfile(admin, session.tenantId);
    const catalogueRows = await loadCatalogueRows(admin, operator.companyId ?? session.tenantId);
    const catalogue = new Map(catalogueRows.map((i) => [i.id, i]));
    const resolved = resolveAll(event.newDefects, catalogue);
    if (!resolved.ok) return refuse(400, resolved.error);
    const reported = resolved.value.map((d) => d.catalogueItemId).filter((id): id is string => Boolean(id));
    const dangerousLabels = resolved.value.filter((d) => d.finalSeverity === "dangerous").map((d) => d.label);
    endCheck = {
      client_id: event.clientId,
      result: checkResult(resolved.value),
      snapshot: toSnapshot(reported.map((id) => catalogue.get(id)).filter((i): i is CatalogueItem => Boolean(i))),
      vor_reason: dangerousLabels.length ? vorReasonForDefects(dangerousLabels) : null,
      defects: rpcDefects(resolved.value),
    };
  }

  const { data, error } = await admin.rpc("shift_record_event", {
    p: {
      tenant_id: session.tenantId,
      driver_id: session.driverId,
      type: event.type,
      client_id: event.clientId,
      occurred_at: event.occurredAt,
      flags,
      odometer: event.type === "shift_ended" ? event.odometer : null,
      end_check: endCheck,
    },
  });
  if (error) return rpcError(error);
  return { status: 200, body: { ok: true, ...(data as Record<string, unknown>) } };
}

async function processObjection(admin: SupabaseClient, session: DriverSession, event: Extract<DriverEvent, { type: "objection_raised" }>): Promise<ProcessResult> {
  const { data: existing, error: existingError } = await admin
    .from("defect_objections")
    .select("id,status")
    .eq("tenant_id", session.tenantId)
    .eq("client_id", event.clientId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return { status: 200, body: { ok: true, duplicate: true, objectionId: existing.id, status: existing.status } };

  // The defect must be on one of THIS driver's checks and be dangerous.
  const { data: defect, error } = await admin
    .from("walkaround_defects")
    .select("id,final_severity,rectified_at,walkaround_checks!inner(driver_id)")
    .eq("tenant_id", session.tenantId)
    .eq("client_id", event.defectClientId)
    .eq("walkaround_checks.driver_id", session.driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!defect) return refuse(404, "That defect was not found. If you are offline, it will be sent after your check.");
  if (defect.final_severity !== "dangerous") return refuse(409, "Only a defect that took the vehicle off the road can be objected to.");
  if (defect.rectified_at) return refuse(409, "That defect has already been fixed.");

  const { data: inserted, error: insertError } = await admin
    .from("defect_objections")
    .insert({ tenant_id: session.tenantId, defect_id: defect.id, driver_id: session.driverId, client_id: event.clientId, reason: event.reason, raised_at: event.occurredAt })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return refuse(409, "An objection to this defect is already waiting for a decision.");
    throw new Error(insertError.message);
  }
  return { status: 200, body: { ok: true, duplicate: false, objectionId: inserted.id } };
}

export async function processDriverEvent(admin: SupabaseClient, session: DriverSession, event: DriverEvent, receivedAt: Date): Promise<ProcessResult> {
  if (event.type === "check_submitted") return processCheck(admin, session, event, receivedAt);
  if (event.type === "objection_raised") return processObjection(admin, session, event);
  return processShiftEvent(admin, session, event, receivedAt);
}
```

- [ ] **Step 3: Write `app/api/driver/shift/route.ts`**

```ts
import { NextResponse } from "next/server";
import { driverErrorResponse } from "../../../../lib/driver/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { loadDriverShiftState, requireDirectDriver } from "../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The driver's shift, current vehicle, checklist and any VOR that is stopping them. */
export async function GET() {
  try {
    const session = await requireDirectDriver();
    const state = await loadDriverShiftState(createAdminClient(), session);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Write `app/api/driver/shift/events/route.ts`**

```ts
import { NextResponse } from "next/server";
import { driverErrorResponse } from "../../../../../lib/driver/server";
import { checkRateLimit } from "../../../../../lib/rateLimit";
import { parseDriverEvent } from "../../../../../lib/shifts/events";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { processDriverEvent } from "../../../../../lib/walkaround/processEvent";
import { requireDirectDriver } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  One queued driver event per request, in the order the phone recorded them.
  Idempotent: a repeated clientId answers 200 with duplicate: true.
*/
export async function POST(request: Request) {
  try {
    const session = await requireDirectDriver();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = parseDriverEvent(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const result = await processDriverEvent(createAdminClient(), session, parsed.event, new Date());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
```

Before writing, read `lib/rateLimit.ts`. If a rule fits (per-user write limit), add `checkRateLimit` with a new `RATE_LIMITS.driverShiftEvent` rule of 120 per 10 minutes keyed on `session.userId`, following how an existing route calls it; otherwise remove the unused import. Do not invent a new limiter.

- [ ] **Step 5: Write the photo routes**

`app/api/driver/walkaround/photos/upload-url/route.ts`: body `{ defectClientId, mimeType, size }`.
1. `requireDirectDriver()`.
2. Validate `mimeType` is one of `image/jpeg`, `image/png`, `image/webp`, `image/heic` and `size` is a number between 1 and 10485760; else 400.
3. Load the defect: `walkaround_defects` joined `walkaround_checks!inner(driver_id)` by `tenant_id = session.tenantId`, `client_id = defectClientId`, `walkaround_checks.driver_id = session.driverId`; select `id, check_id, photo_paths`. Not found: 404 "That defect has not synced yet." (the queue retries: see Task 21, a 404 on photos is treated as retry, not reject). `photo_paths.length >= 5`: 409 "A defect can have at most five photos."
4. Path: `${session.tenantId}/${defect.check_id}/${defectClientId}/${randomUUID()}.${ext}` where ext is `jpg|png|webp|heic` from the mime type.
5. `admin.storage.from("walkaround-photos").createSignedUploadUrl(path)`; answer `{ path, token }`.

`app/api/driver/walkaround/photos/route.ts`: body `{ defectClientId, path }`.
1. `requireDirectDriver()`, reload the defect as above.
2. Refuse (400) unless `path` starts with `${session.tenantId}/${defect.check_id}/${defectClientId}/` and contains no `..`.
3. Confirm the object exists: `admin.storage.from("walkaround-photos").list(folder, { search: filename })` returns it; else 409 "The photo did not finish uploading."
4. If `photo_paths` already contains `path`, answer 200 (idempotent). Else update `photo_paths = [...photo_paths, path]` filtered by `id` and `tenant_id`; answer 200 `{ ok: true }`.

Mirror the structure (imports, try/catch, `driverErrorResponse`) of `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url/route.ts` and `.../evidence/route.ts`.

- [ ] **Step 6: Run the route classification test, the suite and typecheck**

Run: `npx vitest run lib/auth/routeClassification.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/walkaround/processEvent.ts app/api/driver/shift app/api/driver/walkaround lib/auth/routeClassification.test.ts lib/rateLimit.ts
git commit -m "Add driver shift, walkaround event and photo routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: The job gate in the driver stop routes

**Files:**
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route.ts`
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/route.ts` (POST only)
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url/route.ts`

- [ ] **Step 1: Add the gate to each route**

In each handler, immediately after `const session = await requireDriverSession({ jobId });` and `const admin = createAdminClient();`, insert:

```ts
    const gate = await jobGateResponse(admin, session);
    if (gate) return gate;
```

with the import `import { jobGateResponse } from "<relative>/lib/walkaround/server";` (same relative depth as the existing `lib/supabase/admin` import in that file). In `complete/route.ts` place it inside the `if (!alreadyCompleted) {` block so a repeated completion of an already delivered stop still answers its idempotent success.

- [ ] **Step 2: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/api/driver/jobs/[jobId]/stops/[stopId]"
git commit -m "Gate stop completion and POD uploads on a passed walkaround check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Office routes

**Files:**
- Create: `app/api/shifts/route.ts` (POST office start)
- Create: `app/api/shifts/[id]/corrections/route.ts`
- Create: `app/api/walkaround/objections/[id]/route.ts`
- Create: `app/api/walkaround/checks/[id]/photos/route.ts`
- Create: `app/api/settings/walkaround/route.ts`, `app/api/settings/walkaround/items/route.ts`, `app/api/settings/walkaround/items/[id]/route.ts`
- Create: `app/api/vehicles/[id]/walkaround-qr/route.ts`
- Modify: `lib/auth/routeClassification.test.ts`

Reads for office pages go through the browser Supabase client and RLS (`tenant_read`), like `/dashboard` does today. These routes exist only for writes and for signed photo URLs. Each route gets the signed-in user with `createApiSupabase()` from `lib/api/server.ts` (`supabase.auth.getUser()`; 401 without a user), loads the target row with `createAdminClient()` to learn its `tenant_id`, then authorizes:

| Route | Authorize with | Level |
|---|---|---|
| `POST /api/shifts` | `authorizeOfficeTenant(admin, user.id, body.tenantId)` | access |
| `POST /api/shifts/[id]/corrections` | `authorizeOfficeTenant(admin, user.id, shift.tenant_id)` | access |
| `PATCH /api/walkaround/objections/[id]` | `authorizeTenant(admin, user.id, objection.tenant_id, "manage")` | manage (admin) |
| `GET /api/walkaround/checks/[id]/photos` | `authorizeOfficeTenant(admin, user.id, check.tenant_id)` | access |
| `GET/PUT /api/settings/walkaround`, `POST .../items`, `PATCH .../items/[id]` | `requireTenant(request)` for the tenant, then `authorizeTenant(admin, user.id, tenantId, "manage")`; company = `authorized.tenant.companyId ?? tenantId`. GET only needs `"access"`. | manage |
| `POST /api/vehicles/[id]/walkaround-qr` | `authorizeTenant(admin, user.id, vehicle.tenant_id, "manage")` | manage |

Turn `TenantAccessError` into a response with `officeAccessErrorResponse` from `lib/jobs/officeAccess.ts`. Read `lib/auth/serverTenantAccess.ts` and `lib/jobs/officeAccess.ts` first.

- [ ] **Step 1: Add the eight routes to `routeClassification.test.ts`, run it, see it fail**

```ts
  "/api/settings/walkaround",
  "/api/settings/walkaround/items",
  "/api/settings/walkaround/items/[id]",
  "/api/shifts",
  "/api/shifts/[id]/corrections",
  "/api/vehicles/[id]/walkaround-qr",
  "/api/walkaround/checks/[id]/photos",
  "/api/walkaround/objections/[id]",
```
Run: `npx vitest run lib/auth/routeClassification.test.ts`
Expected: FAIL.

- [ ] **Step 2: `POST /api/shifts`** (office starts a shift for a driver; hours only)

Body `{ tenantId, driverId, startedAt, reason }`. Validate uuids, `startedAt` parses and is not more than 5 minutes in the future, `reason.trim().length >= 3`. Check the driver row exists with `drivers.tenant_id = tenantId`. Call `admin.rpc("shift_office_start", { p: { tenant_id, driver_id, user_id: user.id, started_at, reason } })`; map errors with `rpcErrorResponse` from `lib/walkaround/server.ts`. Answer `{ shiftId }`.

- [ ] **Step 3: `POST /api/shifts/[id]/corrections`**

Body `{ field: "started_at" | "ended_at", value, reason }`. Load `driver_shifts` by id (`id, tenant_id, started_at, ended_at`), 404 if missing, authorize. Validate: value parses; not in the future beyond 5 minutes; `started_at` must stay before any `ended_at`; `ended_at` must be after `started_at`; reason at least 3 characters. Call `shift_apply_correction`. Answer `{ ok: true }`.

- [ ] **Step 4: `PATCH /api/walkaround/objections/[id]`**

Body `{ decision: "approve" | "reject", note, liabilityAccepted, liabilityVersion }`. Load the objection (`id, tenant_id, status`), 404 if missing, authorize at `"manage"` (admin only; staff get 403 "Only an admin can decide an objection."). Refuse 409 unless `status === "pending"`. For approve: require `liabilityAccepted === true` and `liabilityVersion === LIABILITY_NOTICE_VERSION` (from `lib/walkaround/liability.ts`), else 400 "Accept the notice to approve." Update with a guard so two admins cannot both decide:

```ts
const { data, error } = await admin
  .from("defect_objections")
  .update({
    status: decision === "approve" ? "approved" : "rejected",
    decided_by_user_id: user.id,
    decided_at: new Date().toISOString(),
    decision_note: note?.trim() || null,
    liability_notice_version: decision === "approve" ? LIABILITY_NOTICE_VERSION : null,
    liability_accepted: decision === "approve",
  })
  .eq("id", id)
  .eq("status", "pending")
  .select("id")
  .maybeSingle();
if (error) throw error;
if (!data) return NextResponse.json({ error: "Someone else has already decided this objection." }, { status: 409 });
```

Approval does NOT return the vehicle to service: the admin still does that on `/maintenance`, where `WLK01` now lets it through. Answer `{ ok: true }`.

- [ ] **Step 5: `GET /api/walkaround/checks/[id]/photos`**

Load the check (`id, tenant_id`), authorize, load its defects' `id, client_id, photo_paths`, and answer `{ photos: [{ defectClientId, url }] }` where each url is `admin.storage.from("walkaround-photos").createSignedUrl(path, 300)` (five minutes). Skip any path that fails to sign, logging it.

- [ ] **Step 6: Settings routes**

`GET /api/settings/walkaround`: answer `{ baseline: CatalogueItem[], companyItems: CatalogueItem[], onCallPhone: string | null, canEdit: boolean }` using `loadCatalogueRows` and splitting on `companyId`. `canEdit` is `tier === "admin" || tier === "super_admin"`.

`PUT /api/settings/walkaround`: body `{ onCallPhone }`; trim; empty means null; else must match `/^[0-9 +()-]{6,32}$/`, 400 otherwise. Upsert `walkaround_settings` `{ company_id, on_call_phone, updated_by_user_id, updated_at }` on `company_id`.

`POST /api/settings/walkaround/items`: body is a `CompanyItemInput`; load existing company codes, run `validateCompanyItem`; 400 with its error; insert `{ company_id, code, category, item_label, defect_label, guidance, severity, applies_to, sort_order }` with `sort_order` = 10 more than the company's current maximum (start at 10000 so company items sort after the baseline). Answer the new item via `toCatalogueItem`.

`PATCH /api/settings/walkaround/items/[id]`: body `{ severity?, guidance?, retired? }`. Load the row; 404 unless `company_id === companyId` (a baseline row is never editable; the `WLK03` trigger backs this). Build the update from only the provided fields (validate severity and guidance length as `validateCompanyItem` does); `retired: true` sets `retired_at = now`, `retired: false` clears it. Answer the updated item.

- [ ] **Step 7: `POST /api/vehicles/[id]/walkaround-qr`**

Load the vehicle (`id, tenant_id, registration`), 404 if missing, authorize at `"manage"`. `const token = generateQrToken();` update `walkaround_qr_token_hash = hashQrToken(token)` on that id. Answer `{ payload: encodeQrPayload(token), registration }` with `Cache-Control: no-store`. The token is shown once; printing again means issuing a new one, which invalidates the old sticker. Say so in a code comment.

- [ ] **Step 8: Run the route test, suite and typecheck**

Run: `npx vitest run lib/auth/routeClassification.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/api/shifts app/api/walkaround app/api/settings/walkaround "app/api/vehicles/[id]/walkaround-qr" lib/auth/routeClassification.test.ts
git commit -m "Add office routes for shifts, objections, walkaround settings and cab QR codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase D: user interface

UI conventions (read before Task 21): console pages copy the structure of `app/dashboard/page.tsx` (`useTenant()`, `createClient()` from `lib/supabase/browser`, `applyTenantFilter(query, tenant.activeTenantId)` from `lib/tenant/filter.ts`, a load-sequence ref to drop stale loads, `Skeleton` while loading). Root element `className="ds font-sans bg-canvas text-ink ..."`. Tokens only (`text-ink-2`, `bg-surface`, `border-line`, status colours as the dashboard uses them); never `dark:` variants; avoid `text-ink-3` for body copy. Writes go through the Phase C routes with `fetch`, sending `x-tenant-id` where the route uses `requireTenant`. Driver pages under `/driver/walkaround` use the fixed light palette of `app/driver/jobs/[jobId]/page.tsx` (read it first) and are NOT added to `themeableRoutes.ts`.

Copy rules for every screen: "recorded hours", never "legal" or "compliant hours"; the checklist is "based on the DVSA daily walkaround check", never "DVSA approved"; long-duty warnings read "On duty over 13h".

### Task 21: Driver offline queue client

**Files:**
- Create: `lib/offline/idbStore.ts` (IndexedDB adapter, client)
- Create: `app/driver/driverQueue.ts` (module singleton: enqueue, flush, subscribe)
- Create: `app/driver/useDriverShift.ts` (hook: server state + projection + queue)

- [ ] **Step 1: `lib/offline/idbStore.ts`**

A thin promise wrapper over one IndexedDB database `tms-driver-queue`, version 1, object store `items` keyPath `id`, plus a `seq` number index so reads come back in insertion order. Export:

```ts
export type StoredItem<T> = QueueItem<T> & { seq: number };
export async function idbLoadAll<T>(): Promise<StoredItem<T>[]>;      // ordered by seq
export async function idbPut<T>(item: StoredItem<T>): Promise<void>;
export async function idbDelete(id: string): Promise<void>;
export function idbAvailable(): boolean;                              // false in SSR or private modes that block IDB
```

Wrap every call in try/catch; on failure fall back to an in-memory array and log once with `console.warn("[driver-queue] IndexedDB unavailable, queue is memory-only")`. No vitest test (browser API); keep it under 80 lines so it is obviously correct.

- [ ] **Step 2: `app/driver/driverQueue.ts`**

```ts
"use client";
/*
  The driver's offline queue: shift and walkaround events plus defect photos,
  sent strictly in order to the server. State rules live in lib/offline/queue.ts.
*/
export type QueuePayload =
  | { kind: "event"; event: DriverEvent }
  | { kind: "photo"; defectClientId: string; blob: Blob; mimeType: string; filename: string };
```

Exports: `enqueueEvent(event)`, `enqueuePhoto(defectClientId, blob, mimeType, filename)`, `flushDriverQueue(): Promise<{ remaining: number }>`, `subscribe(listener: (snapshot: { pending: QueueItem<QueuePayload>[]; rejected: { id: string; message: string }[] }) => void): () => void`, `dismissRejected(id)`.

Sending:
- `event`: `POST /api/driver/shift/events` with the event JSON. 2xx is `sent`. Otherwise `classifySyncFailure(status)`: `retry` backs off; `stop` (401/403) pauses the queue until the next `flushDriverQueue` call and surfaces "Sign in again to send your checks."; `rejected` removes it and records the server's `error` message.
- `photo`: `POST /api/driver/walkaround/photos/upload-url`, then `createClient().storage.from("walkaround-photos").uploadToSignedUrl(path, token, blob, { contentType })`, then `POST /api/driver/walkaround/photos`. A 404 from either route means the defect has not synced yet: treat it as `retry`, not `rejected`. Mirror `lib/pod/uploadClient.ts`.
- Flush loop: run on `enqueue*`, on `window` `online`, on `document` `visibilitychange` to visible, and on a timer at the head item's `nextAttemptAt`. Only one flush runs at a time (a module-level promise).
- Persist every change through `idbStore`, and load the stored queue once on first use.
- `beforeunload`: when pending items exist, set `event.returnValue` so the browser warns before closing.

- [ ] **Step 3: `app/driver/useDriverShift.ts`**

A hook returning `{ state: DriverShiftState | null, pendingCount, rejected, error, reload, submit(event), submitPhoto(...) }`. It fetches `GET /api/driver/shift` (no-store), subscribes to the queue, and returns `projectDriverState(serverState, pendingEvents)` (Task 11). After a successful flush it re-fetches server state. `submit` calls `enqueueEvent` with `clientId: crypto.randomUUID()` and `occurredAt: new Date().toISOString()` already set by the caller.

- [ ] **Step 4: Flush before POD saves**

In `app/driver/jobs/[jobId]/page.tsx`, at the start of the photo upload handler and of `completeDelivery`, add `await flushDriverQueue();`. If it returns `remaining > 0`, carry on anyway: the server gate will answer 409 with a clear message, which the page already shows.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add lib/offline/idbStore.ts app/driver/driverQueue.ts app/driver/useDriverShift.ts "app/driver/jobs/[jobId]/page.tsx"
git commit -m "Add the driver offline queue client and shift state hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: Driver dashboard shift panel

**Files:**
- Create: `app/driver/dashboard/ShiftPanel.tsx`
- Modify: `app/driver/dashboard/page.tsx`

- [ ] **Step 1: Build `ShiftPanel`** (uses `useDriverShift`)

States, top to bottom of the dashboard, above "Compliance":
- **Sync strip** when `pendingCount > 0`: "N items waiting to sync" (and "Offline" when `navigator.onLine` is false). Each rejected item shows its message with a Dismiss button.
- **No shift, no blocking check:** assigned vehicle line ("Assigned today: AB12 CDE" or "No vehicle assigned today") and a primary **Start shift** link to `/driver/walkaround?phase=start`.
- **Blocking check** (`state.blockingCheck`): red panel "AB12 CDE is off the road. Do not drive this vehicle. The office has been told." Then EVERY defect: label, `reason` (why it is dangerous), `guidance` ("What to look for: ..."), the driver's note, "N photos". Per defect: its objection status if any ("Objection sent, waiting for a decision" / "Objection approved" / "Objection rejected: <note>"), otherwise **Object to this**, which opens an inline form (reason, 3 to 1000 characters) and submits an `objection_raised` event. Then **Call transport manager** as `<a href={"tel:" + onCallPhone}>`, shown only when `onCallPhone` is set; otherwise the text "Your company has not set an on-call number. Contact the office." Then **Check a different vehicle** to `/driver/walkaround?phase=start` (or `phase=swap` when a shift is open).
- **On shift:** "On shift since 05:48" (operator-local time with `Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })`), the current vehicle, recorded duty so far via `summariseShift` + `formatMinutes` (label: "Recorded hours"), and "On duty over 13h" when flagged. Buttons: **Start break** / **End break** (events `break_started` / `break_ended`), **Swap vehicle** (`/driver/walkaround?phase=swap`), **End shift** (opens the end-shift form: odometer number input, required; "Any new defects since your check?" No / Yes; Yes reveals the defect picker from Task 23 for the current vehicle; submit sends `shift_ended` with `newDefects`).

- [ ] **Step 2: Lock today's jobs until the gate would pass**

In `app/driver/dashboard/page.tsx`, compute `canWork` from the projected state with `jobGateDecision({ portalType: "direct_driver", openShift: state.openShift ? { currentPeriod: state.openShift.currentVehicle ? { vehicleId: state.openShift.currentVehicle.vehicleId, checkResult: state.openShift.currentVehicle.checkResult, vehicleVor: false } : null } : null })`. When not `ok`, render job rows without their link and show the decision's `message` above the list. Subcontractor drivers do not use this dashboard's gate: if `GET /api/driver/shift` answers 403, hide the panel and leave jobs unlocked.

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck && npm test`

```bash
git add app/driver/dashboard
git commit -m "Add the shift panel and job lock to the driver dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: The walkaround check screens

**Files:**
- Create: `app/driver/walkaround/page.tsx` and, beside it, `VehicleStep.tsx`, `ChecklistStep.tsx`, `DefectPicker.tsx`, `ReviewStep.tsx`, `ResultStep.tsx`
- Modify: `app/driver/layout.tsx` only if the new page needs the same wrapper the jobs page gets (read it; it already mounts `DriverGpsTracker` for every `/driver` page)
- Modify: `lib/auth/routeClassification.test.ts` (add `/driver/walkaround` as protected)

Fixed light palette: copy the colour classes used by `app/driver/jobs/[jobId]/page.tsx`. Large tap targets (at least 44px), one step per screen, a Back button on every step, state kept in the page component so Back never loses input.

- [ ] **Step 1: Route test first**

Add `"/driver/walkaround"` to the protected pages list in `lib/auth/routeClassification.test.ts`; run it; see it fail.

- [ ] **Step 2: `page.tsx`** reads `phase` from the search params (`start` default, or `swap`), uses `useDriverShift()`, and walks: Vehicle, (swap only) end odometer of the vehicle being left, Odometer, Checklist, Review, Result. If `phase=start` and a shift is already open, redirect to `/driver/dashboard`.

- [ ] **Step 3: `VehicleStep`**: the assigned vehicle pre-selected. Two confirmations: **Scan cab QR** (render `app/driver/jobs/[jobId]/CameraBarcodeScanner.tsx`; its `onScan` receives the decoded text: run `parseQrPayload`; a non-walkaround code shows "That is not a TMS Wizzard cab code" and resolves the scanner with a failure result the component accepts) or **Type registration** (text input, compared locally with `registrationsMatch` for instant feedback; the server re-checks). **Different vehicle**: a list of `state.vehicles` excluding VOR ones (VOR shown greyed with "Off the road"), plus a required reason textarea when the choice differs from `assignedVehicle`. If `CameraBarcodeScanner`'s `onScan` contract does not fit, extract the camera part into a shared component rather than duplicating it.

- [ ] **Step 4: `ChecklistStep`**: `groupByItem(state.catalogue)` filtered to `appliesTo !== "trailer"` unless the driver ticks "I am pulling a trailer" at the top (then all). One card per group: item label, guidance of the first defect as "What to look for", two buttons **OK** / **Defect**. Nothing is pre-marked: every group needs an answer before Next is enabled, and a counter shows "12 of 26 checked". **Defect** opens `DefectPicker`.

- [ ] **Step 5: `DefectPicker`** (also reused by the end-shift form): radio list of that group's defects (label plus a "Dangerous: vehicle will go off the road" badge on dangerous ones), plus "Other" with a required note. For a minor choice, a checkbox "This is dangerous, the vehicle should not be driven" sets `driverSeverity: "dangerous"`; there is no control that lowers a dangerous one. Optional note (1000 characters) and up to five photos: `<input type="file" accept="image/*" capture="environment">`, resized with `lib/driver/imageResize.ts` exactly as the jobs page resizes POD photos. Each defect gets `clientId: crypto.randomUUID()` when created.

- [ ] **Step 6: `ReviewStep`**: vehicle, odometer, each defect with its severity as the catalogue decides it (use `resolveDefect` locally so the driver sees "DANGEROUS" before submitting), the declaration checkbox "I declare this check is accurate and complete", and **Submit check** (disabled until ticked). Submitting builds a `check_submitted` event with `checklistItemIds` = the ids of every catalogue row shown in the checklist (all rows of the groups displayed, in order), calls `submit(event)`, then queues each photo with `submitPhoto(defectClientId, blob, ...)`. It works offline: it only enqueues.

- [ ] **Step 7: `ResultStep`**: from the projected state. Pass or minor: "Check submitted. Your shift has started." (or "Vehicle swapped."), "Waiting to sync" when pending, a button to Today's jobs. Dangerous: navigate to `/driver/dashboard`, where Task 22's blocking panel shows every defect, its reason and guidance, Object, Call and Check a different vehicle.

- [ ] **Step 8: Typecheck, test, commit**

Run: `npm run typecheck && npm test`

```bash
git add app/driver/walkaround lib/auth/routeClassification.test.ts app/driver/layout.tsx
git commit -m "Add the driver walkaround check screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 24: The `/shifts` page

**Files:**
- Create: `app/shifts/page.tsx`, `app/shifts/ShiftDialogs.tsx`
- Create: `lib/shifts/fleetQuery.ts` (browser loader that builds a `FleetInput`)
- Modify: `lib/nav/navConfig.ts` (add `{ id: "shifts", label: "Shifts", href: "/shifts", icon: "Clock" }` to the Operations group after Planning), `lib/nav/themeableRoutes.ts` and its test (add `"/shifts"`), `lib/auth/routeClassification.test.ts` (add `/shifts`), and any list the nav tests assert (`lib/nav/skeletonReadyRoutes.ts` if the page uses skeletons; run `npx vitest run lib/nav` to find out)

- [ ] **Step 1: Lists first, see them fail**

Add `/shifts` to `routeClassification.test.ts`, `themeableRoutes.ts` plus the exact-list assertion in `themeableRoutes.test.ts`, and the nav entry. Run `npx vitest run lib/nav lib/auth/routeClassification.test.ts`. Expected: route classification FAILS until the page exists.

- [ ] **Step 2: `lib/shifts/fleetQuery.ts`**

`export async function loadFleetInput(supabase: SupabaseClient, activeTenantId: string | null, today: string, now: Date): Promise<FleetInput>` running, all through `applyTenantFilter(query, activeTenantId)`:
- `vehicles`: `id, registration, vor` (active or VOR).
- `drivers`: count where `active = true`.
- `driver_shifts`: `id, driver_id, started_at, ended_at, flags, drivers(name)` where `ended_at is null` OR `started_at >= <today 00:00 operator time as ISO>`; plus `shift_breaks` with `ended_at is null` for those shift ids (to set `onBreak`) and open `shift_vehicle_periods` (to set `currentVehicleId`).
- `walkaround_checks`: `id, vehicle_id, driver_id, performed_at, result, flags, drivers(name)` where `phase in (start, swap)` and `performed_at >= today start`; `assignedVehicleMismatch = flags includes "assigned_vehicle_mismatch"`.
- `walkaround_defects`: `id, vehicle_id, final_severity, label, created_at` where `rectified_at is null`.
- `defect_objections`: `id, raised_at, drivers(name), walkaround_defects(vehicle_id, label)` where `status = pending`.
- `jobs`: `vehicle_id` for today (same `or(...)` filter the driver `me` route uses), non-null.
Compute "today start" from `today` (a `YYYY-MM-DD` operator day) with the helpers in `lib/time.ts`; do not use UTC midnight.

- [ ] **Step 3: `app/shifts/page.tsx`** with two tabs (query string `?tab=today|history`, default today):
- **Fleet today**: `fleetTodayRows(input)` as a table: Vehicle, Driver, Walkaround (time, coloured by result), Shift (On duty Xh Ym / On break / Ended / Not started), Defects (N open, M dangerous), VOR badge. "On job today, not checked" rows are highlighted.
- **History**: date range (default last 7 operator days), driver filter; loads `driver_shifts` in range with breaks, vehicle periods (with registrations) and `shift_corrections`; each row shows `summariseShift` values (Recorded duty, Breaks, Worked excl. breaks, Mileage), flags as plain text, "Corrected" when a correction exists (expandable to show who, when, old, new, reason). **Export CSV** builds `shiftsToCsv` rows and downloads `shifts-<from>-to-<to>.csv` via a Blob URL.
- A footnote on both tabs: "Recorded hours as logged by drivers. Tachograph data remains the legal record of driving time; no Working Time or rest-period check is made here."
- Read-only while "All tenants" is selected, with the same message the planning page shows, because writes need a tenant.

- [ ] **Step 4: `ShiftDialogs.tsx`** (office actions, hidden for non-office users; the routes enforce it anyway):
- **Start shift for a driver**: driver select, start time (defaults to now), reason. Explains "This records hours only. The driver still needs to complete a walkaround check in the app before they can work on jobs." POST `/api/shifts`.
- **End shift** (open shifts) and **Correct start/end** (any shift): time input, required reason. POST `/api/shifts/[id]/corrections`. Explain "The driver's original times are kept in the correction history."

- [ ] **Step 5: Test, typecheck, commit**

Run: `npm test && npm run typecheck`

```bash
git add app/shifts lib/shifts/fleetQuery.ts lib/nav lib/auth/routeClassification.test.ts
git commit -m "Add the Shifts page: fleet today, recorded-hours history, CSV and office corrections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 25: Maintenance walkaround tab and objections

**Files:**
- Create: `app/maintenance/WalkaroundChecksTab.tsx`, `app/maintenance/ObjectionDecision.tsx`
- Modify: `app/maintenance/page.tsx`

- [ ] **Step 1: Tabs.** Add a tab bar at the top of `/maintenance`: "Records" (the existing page body, unchanged) and "Walkaround checks" (`?tab=walkaround`). Keep the existing page content as-is inside the Records tab: do not refactor it.

- [ ] **Step 2: `WalkaroundChecksTab`**: loads (through `applyTenantFilter`) `walkaround_checks` for a chosen day (default today) with `drivers(name)`, `vehicles(registration)`, filterable by vehicle, driver and result; a list row per check (time, phase, vehicle, driver, result badge, odometer, "Different vehicle: <reason>" when flagged, `late_sync` shown as "Synced late: happened <time>, arrived <time>"). Opening a check shows the `checklist_snapshot` items marked OK or with their defect, each defect's label, severity, "escalated by driver" when true, note, photos (from `GET /api/walkaround/checks/[id]/photos`, rendered as thumbnails linking to the signed URL), linked maintenance record status and rectified time, and objections with `ObjectionDecision`. Above the list, a "Pending objections" strip lists every pending objection for the tenant.

- [ ] **Step 3: `ObjectionDecision`**: shows the driver's reason and time. Admins get Approve and Reject with a note field; Approve shows `LIABILITY_NOTICE_TEXT` and a required checkbox "I accept this on behalf of the operator" before the button enables, then PATCHes with `liabilityVersion: LIABILITY_NOTICE_VERSION`. Non-admins see "Only an admin can decide an objection." After approval show "Approved. Return the vehicle to service from the Records tab when you are ready."

- [ ] **Step 4: Records tab changes, minimal:**
- Tag records whose `maintenance_type` starts with `Walkaround defect:` with a small "Walkaround" badge.
- Where the page clears a vehicle's VOR (the `vehicles.update({ vor: false ... })` calls, around the existing `canChangeVehicleStatus` logic), catch the error with `isReturnBlockedError(error)` from `lib/walkaround/vor.ts` and show `RETURN_BLOCKED_MESSAGE` instead of the raw error.

- [ ] **Step 5: Test, typecheck, commit**

Run: `npm test && npm run typecheck`

```bash
git add app/maintenance
git commit -m "Add the walkaround checks tab and objection decisions to Maintenance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 26: Walkaround settings page

**Files:**
- Create: `app/settings/walkaround/page.tsx`
- Modify: `app/settings/page.tsx` (add a card/link "Walkaround checklist" next to the other settings entries), `lib/nav/themeableRoutes.ts` + test, `lib/auth/routeClassification.test.ts`

- [ ] **Step 1: Lists first** (`/settings/walkaround` in route classification and themeable routes + exact-list test), run, see route classification fail.

- [ ] **Step 2: Page.** Loads `GET /api/settings/walkaround` with `x-tenant-id`. Sections:
- **On-call number**: input and Save (PUT). Help text: "Drivers see a Call transport manager button with this number when a check takes a vehicle off the road."
- **Baseline checklist (locked)**: read-only table grouped by item: defect, severity badge, applies to. Heading note: "Based on the DVSA daily walkaround check. These items and their severities cannot be changed or removed."
- **Your company's items**: table with Add item form (category, item name, defect, guidance, severity, applies to) and per row: change severity, edit guidance, Retire / Restore. Retired items are shown greyed. Non-admins see everything read-only with "Only an admin can change the checklist."

- [ ] **Step 3: Test, typecheck, commit**

```bash
git add app/settings lib/nav lib/auth/routeClassification.test.ts
git commit -m "Add the walkaround checklist settings page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 27: Cab QR codes on `/vehicles`

**Files:**
- Modify: `package.json` / `package-lock.json` (add `qrcode` and `@types/qrcode`)
- Create: `app/vehicles/WalkaroundQrButton.tsx`
- Modify: `app/vehicles/page.tsx` (render the button per vehicle row, admins only)

- [ ] **Step 1: Install**

Run: `npm install qrcode && npm install -D @types/qrcode`
Expected: both added. Check the lockfile changed and nothing else in `dependencies` moved.

- [ ] **Step 2: `WalkaroundQrButton`**: button "Print cab QR code". If the vehicle already has a code (`walkaround_qr_token_hash` is not null in the row the page loaded; add the column to the page's select), confirm first: "Printing a new code stops the old sticker working. Continue?" Then POST `/api/vehicles/[id]/walkaround-qr`, render the payload with `QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2, width: 512 })`, and open a print view (a new window with an `<img>`, the registration in large type, and "Scan at the start of every shift. TMS Wizzard walkaround check."), calling `window.print()`. The payload is never stored in the browser.

- [ ] **Step 3: Typecheck, test, commit**

```bash
git add package.json package-lock.json app/vehicles
git commit -m "Add printable cab QR codes for walkaround vehicle confirmation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 28: Dashboard tiles and attention items

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Load** `loadFleetInput(...)` (Task 24) in the dashboard's existing load, in its own try/catch so a failure (for example the SQL not applied yet) hides the fleet row instead of taking the dashboard down, in the same spirit as the existing getting-started panel.

- [ ] **Step 2: Tiles.** A second KPI row using the dashboard's existing tile component: **On shift now** (`onShift`, sub "of N drivers"), **Walkarounds today** (`vehiclesChecked`, sub "N on jobs unchecked" in warning colour when above zero), **Open defects** (`openDefects`, sub "N dangerous" in danger colour when above zero), **Objections** (`pendingObjections`, sub "awaiting approval"). Each tile is a link: the first two to `/shifts`, the last two to `/maintenance?tab=walkaround`.

- [ ] **Step 3: Needs attention.** Prepend `fleetAttention(input)` to the existing items before the `slice(0, 5)` so dangerous defects and objections are never pushed off the list by older items.

- [ ] **Step 4: Test, typecheck, commit**

```bash
git add app/dashboard/page.tsx
git commit -m "Show shifts, walkarounds, defects and objections on the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase E: docs and verification

### Task 29: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md`

- [ ] **Step 1: README.** In the page inventory add `/shifts` [OK], `/driver/walkaround` [OK], `/settings/walkaround` [OK], and update `/maintenance` (walkaround tab, objections, WLK01), `/dashboard` (fleet tiles), `/driver/dashboard` (shift panel, job lock), `/vehicles` (cab QR). In the roadmap's competitive-gaps line, mark "driver walkaround checks with defect reporting that feeds /maintenance and VOR" as done (built 2026-09-29, SQL `shifts_01..05` pending). Add `qrcode` to the tech stack list.

- [ ] **Step 2: CLAUDE.md.** In the Architecture section, after the "Unlicensed vehicles" bullet, add a bullet: "**Walkaround checks gate driver work.** Own-fleet drivers need an open shift whose current vehicle passed a walkaround (`lib/walkaround/jobGate.ts`, enforced in the stop and POD routes, fails closed). Severity comes from the catalogue, never the phone (`lib/walkaround/severity.ts`); the baseline in `lib/walkaround/baseline.ts` must match `docs/sql/shifts_02` (`baselineSql.test.ts`). Shift and walkaround tables are read-only from the browser; writes go through `shifts_04` RPCs. `WLK01` refuses lifting a VOR while a dangerous defect is open. Shift hours are recorded hours, not a legal calculation." In the styling section, change "three customer- and driver-facing pages" to include `/driver/walkaround`. In the directory map, add `shifts_01..05` to the `docs/sql/` description.

- [ ] **Step 3: Spec.** Apply the four "Spec clarifications decided while planning" from the top of this plan to the spec (move `phase` to `walkaround_checks`; short QR payload; rectification trigger; office start is hours-only).

- [ ] **Step 4: No em-dashes in anything this branch added**

Run: `git diff main --name-only | xargs grep -lP "\x{2014}" || echo none`
Expected: `none`, apart from lines that already existed on main in files like `CLAUDE.md` (check with `git diff main -- <file> | grep -P "^\+.*\x{2014}"`, which must print nothing).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md
git commit -m "Document driver shifts and walkaround checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 30: Full verification

- [ ] **Step 1:** `npm test`. Expected: every test passes; note the count (baseline was 2245).
- [ ] **Step 2:** `npm run typecheck`. Expected: clean.
- [ ] **Step 3:** `npm run build`. Expected: builds. Fix anything it reports.
- [ ] **Step 4:** Record, in the final report, what could NOT be verified here: the SQL is unapplied (nothing ran against a database); no signed-in pass on a phone with airplane mode; no Playwright spec. These are hand steps for Ethan, in this order: apply `shifts_01..05` on a test company first, run `shifts_verify.sql`, set the on-call number, print a QR, do a start check, a minor defect, a dangerous defect with an objection, a swap, a break and an end shift with airplane mode toggled.
