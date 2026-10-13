# Assets Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/assets` into a searchable, sortable table register with add/edit in a dialog, office-only archive/restore, admin-only delete guarded by maintenance history, and office-only writes enforced in Postgres.

**Architecture:** Pure rules (filtering, sorting, payload building, delete decision, error mapping) live in `lib/assets/` with vitest coverage. A new hand-applied migration `docs/sql/assets_01_archive_and_office_writes.sql` adds the archive columns, splits RLS so drivers cannot write and nobody can delete from the browser, guards the archive columns with a trigger, and makes `maintenance_records.asset_id` RESTRICT. Three service-role routes under `app/api/assets/[id]/` do archive, restore and delete after explicit authorization against the asset's own tenant. The page becomes a `DataTable` with a toolbar and an `AssetDialog`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres RLS, PostgREST), vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-assets-phase-a-design.md`

**Branch:** `ethan/assets-phase-a` (already created; spec committed as 343fc14).

## Conventions for whoever executes this

- Read `CLAUDE.md` first. Key rules that bite here: data pages go through `useTenant()`; route handlers on the service-role client must authorize explicitly; every new route file must be listed in `lib/auth/routeClassification.test.ts`; vitest only runs `lib/**/*.test.ts`.
- Never use em-dashes in code, comments, docs or commit messages (the user's standing rule).
- Do NOT apply the SQL. Ethan applies migrations by hand in the Supabase SQL editor.
- `.env.local` points at the LIVE Supabase project. Do not click save buttons on localhost.
- Run commands from the repo root `C:\Users\ethan\Desktop\tms`.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Deviations from the spec (decided while planning)

1. `Asset`/`AssetType` move to `lib/assets/types.ts` (so pure modules in `lib/` can use them); `app/assets/types.ts` is deleted rather than edited.
2. The form-to-payload logic moves out of the page into `lib/assets/payload.ts` so it gets unit tests.
3. `useTenant()` folds drivers into `staff`, so the client cannot tell a driver from office staff. The page calls the `pod_caller_is_office()` RPC once (granted to `authenticated` by `assets_01`); on any error it assumes "unknown" and shows the controls, leaving RLS to refuse.
4. 409 bodies are `{ error: <readable message>, code: "<machine code>" }` rather than `{ error: "<code>" }`, so the dialog can show `error` directly.
5. `isMissingColumnError` and `isForeignKeyViolation` live in `lib/assets/errors.ts` (client-safe) rather than `deleteRule.ts`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `lib/assets/types.ts` | create | `Asset`, `AssetType`, form values, identifier and status lists, label helpers |
| `lib/assets/payload.ts` (+ test) | create | validate the form, build the insert/update payload |
| `lib/assets/register.ts` (+ test) | create | filter, sort, identifier summary, sort toggling |
| `lib/assets/errors.ts` (+ test) | create | map Postgres/PostgREST errors to user messages; error-code predicates |
| `lib/assets/deleteRule.ts` (+ test) | create | delete decision; route result to HTTP mapping |
| `lib/assets/officeFunctionSql.test.ts` | create | keeps `assets_01` in step with `shifts_06` |
| `lib/assets/server.ts` | create | server-only: authorize, archive/restore, delete |
| `docs/sql/assets_01_archive_and_office_writes.sql` | create | migration (not applied by this plan) |
| `app/api/assets/[id]/route.ts` | create | `DELETE` |
| `app/api/assets/[id]/archive/route.ts` | create | `POST` archive |
| `app/api/assets/[id]/restore/route.ts` | create | `POST` restore |
| `lib/auth/routeClassification.test.ts` | modify | list the three routes as protected |
| `components/DataTable.tsx` | modify | optional header sorting |
| `app/assets/StatusBadge.tsx` | create | status badge plus "Archived" badge |
| `app/assets/saveAsset.ts` | create | browser insert/update with duplicate check |
| `app/assets/AssetDialog.tsx` | create | view, edit, archive, restore, delete confirm |
| `app/assets/page.tsx` | rewrite | toolbar, table, dialog wiring |
| `app/assets/AssetCard.tsx`, `app/assets/types.ts` | delete | replaced |
| `README.md`, `CLAUDE.md`, `docs/sql/prodfix_00_APPLY_ORDER.md` | modify | docs |

---

### Task 1: Shared asset types and the form payload

**Files:**
- Create: `lib/assets/types.ts`
- Create: `lib/assets/payload.ts`
- Test: `lib/assets/payload.test.ts`

- [ ] **Step 1: Create `lib/assets/types.ts`**

```ts
/* Shapes shared by the /assets page, its dialog and the pure rules in
   lib/assets/. Client-safe: no server imports. */

export type AssetType = {
  id: string;
  name: string;
};

export type Asset = {
  id: string;
  company_id: string;
  tenant_id: string;
  name: string;
  asset_type: string;
  asset_type_id: string | null;
  asset_number: string | null;
  identifier_type: string | null;
  reference: string | null;
  serial_number: string | null;
  registration: string | null;
  barcode: string | null;
  mechanical: boolean;
  status: string | null;
  notes: string | null;
  created_at: string | null;
  /* Absent (undefined) when docs/sql/assets_01 is not applied: the page then
     loads without these columns and hides the archive controls. */
  archived_at?: string | null;
  archived_by?: string | null;
};

export const IDENTIFIER_TYPES = [
  ["internal", "Internal Asset Number"],
  ["vrm", "VRM / Registration"],
  ["trailer_number", "Trailer Number"],
  ["container_number", "Container Number"],
  ["pallet_number", "Pallet Number"],
  ["barcode", "Barcode"],
  ["serial_number", "Serial Number"],
] as const;

export const ASSET_STATUSES = [
  ["active", "Active"],
  ["maintenance", "Maintenance"],
  ["inactive", "Inactive"],
] as const;

export type AssetFormValues = {
  name: string;
  assetNumber: string;
  identifierType: string;
  assetTypeId: string;
  serialNumber: string;
  barcode: string;
  mechanical: boolean;
  status: string;
  notes: string;
};

export const EMPTY_ASSET_FORM: AssetFormValues = {
  name: "",
  assetNumber: "",
  identifierType: "internal",
  assetTypeId: "",
  serialNumber: "",
  barcode: "",
  mechanical: false,
  status: "active",
  notes: "",
};

export function formFromAsset(asset: Asset): AssetFormValues {
  return {
    name: asset.name ?? "",
    assetNumber: asset.asset_number ?? "",
    identifierType: asset.identifier_type ?? "internal",
    assetTypeId: asset.asset_type_id ?? "",
    serialNumber: asset.serial_number ?? "",
    barcode: asset.barcode ?? "",
    mechanical: Boolean(asset.mechanical),
    status: asset.status ?? "active",
    notes: asset.notes ?? "",
  };
}

const DEFAULT_MECHANICAL_TYPES = new Set([
  "Trailer",
  "Forklift",
  "Fridge Unit",
  "Generator",
  "Plant / Machinery",
]);

/** Picking one of these types ticks "Mechanical" for you; the user can untick it. */
export function defaultMechanical(typeName: string): boolean {
  return DEFAULT_MECHANICAL_TYPES.has(typeName);
}

export function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
```

- [ ] **Step 2: Write the failing test `lib/assets/payload.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildAssetPayload, validateAssetForm } from "./payload";
import { EMPTY_ASSET_FORM, type AssetFormValues, type AssetType } from "./types";

const trailer: AssetType = { id: "type-trailer", name: "Trailer" };
const types = [trailer];

const base: AssetFormValues = {
  ...EMPTY_ASSET_FORM,
  name: " Trailer 12 ",
  assetNumber: " TRL-012 ",
  assetTypeId: "type-trailer",
};

describe("validateAssetForm", () => {
  it("accepts a complete form and returns the chosen type", () => {
    expect(validateAssetForm(base, types)).toEqual({ ok: true, type: trailer });
  });

  it.each([
    [{ name: "   " }, "Asset name is required."],
    [{ assetNumber: "" }, "Asset number is required."],
    [{ assetTypeId: "" }, "Select an asset type."],
    [{ assetTypeId: "type-gone" }, "The selected asset type is invalid."],
  ])("refuses %j", (patch, error) => {
    expect(validateAssetForm({ ...base, ...patch }, types)).toEqual({ ok: false, error });
  });
});

describe("buildAssetPayload", () => {
  it("trims, stores the type name and uses the number as the reference for internal ids", () => {
    expect(buildAssetPayload(base, trailer)).toEqual({
      name: "Trailer 12",
      asset_number: "TRL-012",
      identifier_type: "internal",
      asset_type_id: "type-trailer",
      asset_type: "Trailer",
      reference: "TRL-012",
      registration: null,
      serial_number: null,
      barcode: null,
      mechanical: false,
      status: "active",
      notes: null,
    });
  });

  it("upper-cases a VRM into registration and sets no reference", () => {
    const payload = buildAssetPayload(
      { ...base, identifierType: "vrm", assetNumber: " ab12 cde " },
      trailer,
    );
    expect(payload.registration).toBe("AB12 CDE");
    expect(payload.reference).toBeNull();
  });

  it("falls back to the asset number for an empty serial when the identifier is a serial", () => {
    const payload = buildAssetPayload({ ...base, identifierType: "serial_number" }, trailer);
    expect(payload.serial_number).toBe("TRL-012");
  });

  it("keeps an explicit serial number", () => {
    const payload = buildAssetPayload(
      { ...base, identifierType: "serial_number", serialNumber: " SN-1 " },
      trailer,
    );
    expect(payload.serial_number).toBe("SN-1");
  });

  it("falls back to the asset number for an empty barcode when the identifier is a barcode", () => {
    const payload = buildAssetPayload({ ...base, identifierType: "barcode" }, trailer);
    expect(payload.barcode).toBe("TRL-012");
  });

  it("stores trimmed notes, or null when blank", () => {
    expect(buildAssetPayload({ ...base, notes: "  Spare  " }, trailer).notes).toBe("Spare");
    expect(buildAssetPayload({ ...base, notes: "   " }, trailer).notes).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/assets/payload.test.ts`
Expected: FAIL, cannot resolve `./payload`.

- [ ] **Step 4: Create `lib/assets/payload.ts`**

```ts
/* Form values to the row written to `assets`. Moved out of app/assets/page.tsx
   unchanged in behaviour so it can be tested. Client-safe. */

import type { AssetFormValues, AssetType } from "./types";

export type AssetPayload = {
  name: string;
  asset_number: string;
  identifier_type: string;
  asset_type_id: string;
  asset_type: string;
  reference: string | null;
  registration: string | null;
  serial_number: string | null;
  barcode: string | null;
  mechanical: boolean;
  status: string;
  notes: string | null;
};

export type AssetFormCheck = { ok: true; type: AssetType } | { ok: false; error: string };

export function validateAssetForm(
  values: AssetFormValues,
  assetTypes: readonly AssetType[],
): AssetFormCheck {
  if (!values.name.trim()) return { ok: false, error: "Asset name is required." };
  if (!values.assetNumber.trim()) return { ok: false, error: "Asset number is required." };
  if (!values.assetTypeId) return { ok: false, error: "Select an asset type." };

  const type = assetTypes.find((candidate) => candidate.id === values.assetTypeId);
  if (!type) return { ok: false, error: "The selected asset type is invalid." };

  return { ok: true, type };
}

/* Identifier kinds whose number doubles as the free-text reference. */
const REFERENCE_IDENTIFIERS = new Set([
  "internal",
  "trailer_number",
  "container_number",
  "pallet_number",
]);

export function buildAssetPayload(values: AssetFormValues, type: AssetType): AssetPayload {
  const assetNumber = values.assetNumber.trim();
  const serial = values.serialNumber.trim();
  const barcode = values.barcode.trim();

  return {
    name: values.name.trim(),
    asset_number: assetNumber,
    identifier_type: values.identifierType,
    asset_type_id: type.id,
    asset_type: type.name,
    reference: REFERENCE_IDENTIFIERS.has(values.identifierType) ? assetNumber : null,
    registration: values.identifierType === "vrm" ? assetNumber.toUpperCase() : null,
    serial_number:
      values.identifierType === "serial_number" && !serial ? assetNumber : serial || null,
    barcode: values.identifierType === "barcode" && !barcode ? assetNumber : barcode || null,
    mechanical: values.mechanical,
    status: values.status,
    notes: values.notes.trim() || null,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/assets/payload.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add lib/assets/types.ts lib/assets/payload.ts lib/assets/payload.test.ts
git commit -m "feat(assets): shared asset types and tested form payload"
```

---

### Task 2: Register filtering and sorting

**Files:**
- Create: `lib/assets/register.ts`
- Test: `lib/assets/register.test.ts`

- [ ] **Step 1: Write the failing test `lib/assets/register.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterAssets,
  hasActiveFilters,
  identifierSummary,
  nextSort,
  sortAssets,
} from "./register";
import type { Asset } from "./types";

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a",
    company_id: "c",
    tenant_id: "t",
    name: "Trailer",
    asset_type: "Trailer",
    asset_type_id: "type-trailer",
    asset_number: "TRL-1",
    identifier_type: "internal",
    reference: null,
    serial_number: null,
    registration: null,
    barcode: null,
    mechanical: false,
    status: "active",
    notes: null,
    created_at: "2026-10-01T09:00:00",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

const ids = (list: Asset[]) => list.map((item) => item.id);

describe("filterAssets", () => {
  const assets = [
    asset({ id: "1", name: "Curtainsider 12", asset_number: "TRL-012", registration: "AB12 CDE" }),
    asset({
      id: "2",
      name: "Forklift",
      asset_number: "FLT-1",
      asset_type: "Forklift",
      asset_type_id: "type-forklift",
      serial_number: "SN-998",
      mechanical: true,
      status: "maintenance",
    }),
    asset({ id: "3", name: "Pallet cage", asset_number: "PAL-7", barcode: "5012345678900", status: null }),
    asset({
      id: "4",
      name: "Old trailer",
      asset_number: "TRL-001",
      archived_at: "2026-10-02T10:00:00Z",
      status: "inactive",
    }),
  ];

  it("hides archived assets by default", () => {
    expect(ids(filterAssets(assets, EMPTY_FILTERS))).toEqual(["1", "2", "3"]);
  });

  it("shows archived assets when asked", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, showArchived: true }))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it.each([
    ["curtain", "1"],
    ["trl-012", "1"],
    ["ab12 cde", "1"],
    ["sn-998", "2"],
    ["50123", "3"],
  ])("searches name, number, registration, serial and barcode: %s", (query, id) => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, query }))).toEqual([id]);
  });

  it("trims the search and ignores case", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, query: "  FORKLIFT  " }))).toEqual(["2"]);
  });

  it("filters by type id", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, typeId: "type-forklift" }))).toEqual(["2"]);
  });

  it("treats a missing status as active", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, status: "active" }))).toEqual(["1", "3"]);
  });

  it("filters by status", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, status: "maintenance" }))).toEqual(["2"]);
  });

  it("filters by mechanical", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, mechanical: "yes" }))).toEqual(["2"]);
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, mechanical: "no" }))).toEqual(["1", "3"]);
  });

  it("combines filters", () => {
    expect(
      ids(
        filterAssets(assets, {
          ...EMPTY_FILTERS,
          query: "trl",
          status: "inactive",
          showArchived: true,
        }),
      ),
    ).toEqual(["4"]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty filters, a blank query, and the archive toggle alone", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "   " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, showArchived: true })).toBe(false);
  });

  it("is true when any narrowing filter is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, typeId: "t" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: "inactive" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, mechanical: "no" })).toBe(true);
  });
});

describe("identifierSummary", () => {
  it("prefers registration, then serial, then barcode", () => {
    expect(identifierSummary(asset({ registration: "R", serial_number: "S", barcode: "B" }))).toBe("R");
    expect(identifierSummary(asset({ serial_number: "S", barcode: "B" }))).toBe("S");
    expect(identifierSummary(asset({ barcode: "B" }))).toBe("B");
    expect(identifierSummary(asset({}))).toBe("");
  });
});

describe("sortAssets", () => {
  const list = [
    asset({ id: "a", name: "trailer 10", created_at: "2026-10-01T09:00:00" }),
    asset({ id: "b", name: "Trailer 9", created_at: "2026-10-03T09:00:00" }),
    asset({ id: "c", name: "", created_at: "2026-10-02T09:00:00" }),
  ];

  it("defaults to newest first", () => {
    expect(ids(sortAssets(list, DEFAULT_SORT))).toEqual(["b", "c", "a"]);
  });

  it("sorts names case-insensitively and numerically, empty last", () => {
    expect(ids(sortAssets(list, { key: "name", direction: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("keeps empty values last when descending", () => {
    expect(ids(sortAssets(list, { key: "name", direction: "desc" }))).toEqual(["a", "b", "c"]);
  });

  it("is stable for equal keys in both directions", () => {
    const twins = [asset({ id: "x", name: "Same" }), asset({ id: "y", name: "Same" })];
    expect(ids(sortAssets(twins, { key: "name", direction: "asc" }))).toEqual(["x", "y"]);
    expect(ids(sortAssets(twins, { key: "name", direction: "desc" }))).toEqual(["x", "y"]);
  });

  it("does not mutate its input", () => {
    const copy = [...list];
    sortAssets(list, { key: "name", direction: "asc" });
    expect(list).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("flips direction on the same key", () => {
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toEqual({ key: "name", direction: "asc" });
  });

  it("starts ascending on a new key", () => {
    expect(nextSort(DEFAULT_SORT, "type")).toEqual({ key: "type", direction: "asc" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/assets/register.test.ts`
Expected: FAIL, cannot resolve `./register`.

- [ ] **Step 3: Create `lib/assets/register.ts`**

```ts
/* What the /assets register shows and in what order. Pure and client-side:
   the page loads the tenant's whole list once and narrows it here, which is
   fine at fleet scale (revisit if a tenant passes a few thousand assets). */

import type { Asset } from "./types";

export type StatusFilter = "any" | "active" | "maintenance" | "inactive";
export type MechanicalFilter = "any" | "yes" | "no";

export type AssetFilters = {
  query: string;
  typeId: string;
  status: StatusFilter;
  mechanical: MechanicalFilter;
  showArchived: boolean;
};

export const EMPTY_FILTERS: AssetFilters = {
  query: "",
  typeId: "",
  status: "any",
  mechanical: "any",
  showArchived: false,
};

/** True when something narrows the list. The archive toggle widens it, so it does not count. */
export function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.typeId !== "" ||
    filters.status !== "any" ||
    filters.mechanical !== "any"
  );
}

/** A null status has always displayed as Active, so it filters as Active too. */
export function assetStatus(asset: Asset): string {
  return asset.status || "active";
}

export function isArchived(asset: Asset): boolean {
  return Boolean(asset.archived_at);
}

const SEARCH_FIELDS = ["name", "asset_number", "registration", "serial_number", "barcode"] as const;

export function filterAssets(assets: readonly Asset[], filters: AssetFilters): Asset[] {
  const needle = filters.query.trim().toLowerCase();

  return assets.filter((asset) => {
    if (!filters.showArchived && isArchived(asset)) return false;
    if (filters.typeId && asset.asset_type_id !== filters.typeId) return false;
    if (filters.status !== "any" && assetStatus(asset) !== filters.status) return false;
    if (filters.mechanical === "yes" && !asset.mechanical) return false;
    if (filters.mechanical === "no" && asset.mechanical) return false;
    if (
      needle &&
      !SEARCH_FIELDS.some((field) => (asset[field] ?? "").toLowerCase().includes(needle))
    ) {
      return false;
    }
    return true;
  });
}

/** The one identifier worth a table column: registration, else serial, else barcode. */
export function identifierSummary(asset: Asset): string {
  return asset.registration || asset.serial_number || asset.barcode || "";
}

export type SortKey = "created" | "name" | "number" | "type" | "status" | "mechanical";
export type SortDirection = "asc" | "desc";
export type AssetSort = { key: SortKey; direction: SortDirection };

export const DEFAULT_SORT: AssetSort = { key: "created", direction: "desc" };

function sortValue(asset: Asset, key: SortKey): string {
  switch (key) {
    case "created":
      return asset.created_at ?? "";
    case "name":
      return asset.name ?? "";
    case "number":
      return asset.asset_number ?? "";
    case "type":
      return asset.asset_type ?? "";
    case "status":
      return assetStatus(asset);
    case "mechanical":
      return asset.mechanical ? "yes" : "no";
  }
}

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/* created_at is an ISO-style timestamp string, so a plain comparison orders it
   correctly; the numeric collator would misread fractional seconds. */
function compareValues(key: SortKey, a: string, b: string): number {
  if (key === "created") return a < b ? -1 : a > b ? 1 : 0;
  return collator.compare(a, b);
}

/** Stable, non-mutating. Empty values sort last in both directions. */
export function sortAssets(assets: readonly Asset[], sort: AssetSort): Asset[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  return [...assets].sort((x, y) => {
    const a = sortValue(x, sort.key);
    const b = sortValue(y, sort.key);
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return sign * compareValues(sort.key, a, b);
  });
}

/** Header click: the same column flips direction, a new column starts ascending. */
export function nextSort(current: AssetSort, key: SortKey): AssetSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/assets/register.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/assets/register.ts lib/assets/register.test.ts
git commit -m "feat(assets): register search, filters and sorting"
```

---

### Task 3: Error mapping and the delete rule

**Files:**
- Create: `lib/assets/errors.ts`, `lib/assets/deleteRule.ts`
- Test: `lib/assets/errors.test.ts`, `lib/assets/deleteRule.test.ts`

- [ ] **Step 1: Write the failing test `lib/assets/errors.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  ASSET_ARCHIVE_GUARD_MESSAGE,
  ASSET_ARCHIVED_MESSAGE,
  ASSET_OFFICE_ONLY_MESSAGE,
  assetWriteMessage,
  isForeignKeyViolation,
  isMissingColumnError,
} from "./errors";

describe("assetWriteMessage", () => {
  it("explains an edit to an archived asset (AST02)", () => {
    expect(assetWriteMessage({ code: "AST02", message: "raw" })).toBe(ASSET_ARCHIVED_MESSAGE);
  });

  it("explains a browser write to the archive columns (AST01)", () => {
    expect(assetWriteMessage({ code: "AST01", message: "raw" })).toBe(ASSET_ARCHIVE_GUARD_MESSAGE);
  });

  it("explains an RLS refusal (42501) as office-only", () => {
    expect(assetWriteMessage({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      ASSET_OFFICE_ONLY_MESSAGE,
    );
  });

  it("passes any other message through", () => {
    expect(assetWriteMessage({ code: "23505", message: "duplicate key" })).toBe("duplicate key");
  });

  it("falls back when there is nothing usable", () => {
    expect(assetWriteMessage(null)).toBe("Unable to save asset.");
    expect(assetWriteMessage({})).toBe("Unable to save asset.");
    expect(assetWriteMessage({ message: "" }, "Custom.")).toBe("Custom.");
  });
});

describe("error predicates", () => {
  it("recognises a missing column from Postgres or PostgREST", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "42P01" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });

  it("recognises a foreign key violation", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing test `lib/assets/deleteRule.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  ASSET_HAS_HISTORY_MESSAGE,
  ASSET_NEEDS_MIGRATION_MESSAGE,
  assetRouteResponse,
  decideAssetDelete,
} from "./deleteRule";

describe("decideAssetDelete", () => {
  it("allows an asset with no history", () => {
    expect(decideAssetDelete({ maintenanceRows: 0 })).toEqual({ kind: "allow" });
  });

  it("refuses an asset with maintenance history", () => {
    expect(decideAssetDelete({ maintenanceRows: 3 })).toEqual({ kind: "refuse" });
  });
});

describe("assetRouteResponse", () => {
  it("maps every result to the route contract", () => {
    expect(assetRouteResponse("ok")).toEqual({ status: 200, body: { ok: true } });
    expect(assetRouteResponse("not_found")).toEqual({
      status: 404,
      body: { error: "Asset not found.", code: "not_found" },
    });
    expect(assetRouteResponse("has_maintenance_history")).toEqual({
      status: 409,
      body: { error: ASSET_HAS_HISTORY_MESSAGE, code: "has_maintenance_history" },
    });
    expect(assetRouteResponse("already_archived")).toEqual({
      status: 409,
      body: { error: "This asset is already archived.", code: "already_archived" },
    });
    expect(assetRouteResponse("not_archived")).toEqual({
      status: 409,
      body: { error: "This asset is not archived.", code: "not_archived" },
    });
    expect(assetRouteResponse("needs_migration")).toEqual({
      status: 503,
      body: { error: ASSET_NEEDS_MIGRATION_MESSAGE, code: "needs_migration" },
    });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run lib/assets/errors.test.ts lib/assets/deleteRule.test.ts`
Expected: FAIL, cannot resolve `./errors` and `./deleteRule`.

- [ ] **Step 4: Create `lib/assets/errors.ts`**

```ts
/* Turns asset write refusals into sentences. Client-safe: the page writes
   through the browser client and the routes share the predicates.

   THE CONTRACT with docs/sql/assets_01 (both sides change together):
     AST01  a browser write touched archived_at / archived_by (server-only)
     AST02  a browser update hit an archived row (restore it first)
     42501  RLS refused an insert: the caller is not office staff */

export const ASSET_ARCHIVE_GUARD_ERRCODE = "AST01";
export const ASSET_ARCHIVED_ERRCODE = "AST02";

export const ASSET_ARCHIVE_GUARD_MESSAGE =
  "Archive and restore assets with the buttons in the asset window.";
export const ASSET_ARCHIVED_MESSAGE = "This asset is archived. Restore it before editing.";
export const ASSET_OFFICE_ONLY_MESSAGE = "Only office staff can add or change assets.";
/* An UPDATE that RLS filters out is not an error in Postgres: it matches zero
   rows. The page asks for the updated ids back and shows this when none came. */
export const ASSET_NOT_UPDATED_MESSAGE =
  "This asset was not updated. It may have been removed, or you may not have permission to change it.";

type ErrorLike = { code?: unknown; message?: unknown };

function asErrorLike(error: unknown): ErrorLike | null {
  return error !== null && typeof error === "object" ? (error as ErrorLike) : null;
}

export function assetWriteMessage(error: unknown, fallback = "Unable to save asset."): string {
  const e = asErrorLike(error);
  if (!e) return fallback;
  if (e.code === ASSET_ARCHIVED_ERRCODE) return ASSET_ARCHIVED_MESSAGE;
  if (e.code === ASSET_ARCHIVE_GUARD_ERRCODE) return ASSET_ARCHIVE_GUARD_MESSAGE;
  if (e.code === "42501") return ASSET_OFFICE_ONLY_MESSAGE;
  return typeof e.message === "string" && e.message ? e.message : fallback;
}

/** 42703 (Postgres) or PGRST204 (PostgREST schema cache): assets_01 is not applied. */
export function isMissingColumnError(error: unknown): boolean {
  const e = asErrorLike(error);
  return e?.code === "42703" || e?.code === "PGRST204";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return asErrorLike(error)?.code === "23503";
}
```

- [ ] **Step 5: Create `lib/assets/deleteRule.ts`**

```ts
/* Can an asset be hard-deleted, and what each asset route answers. Pure; the
   routes in lib/assets/server.ts load the counts and map results through here.

   THE RULE. An asset with any maintenance history is archived, never deleted:
   maintenance_records.asset_id used to be ON DELETE SET NULL, so a delete
   silently orphaned the history. docs/sql/assets_01 makes it RESTRICT, so the
   database refuses too. Phase C adds assignment history as another count. */

export type AssetHistoryCounts = {
  maintenanceRows: number;
};

export type AssetDeleteDecision = { kind: "allow" } | { kind: "refuse" };

export const ASSET_HAS_HISTORY_MESSAGE = "This asset has maintenance history. Archive it instead.";
export const ASSET_NEEDS_MIGRATION_MESSAGE =
  "Asset archiving needs the assets_01 database migration. Ask an administrator to apply it.";

export function decideAssetDelete(counts: AssetHistoryCounts): AssetDeleteDecision {
  return counts.maintenanceRows > 0 ? { kind: "refuse" } : { kind: "allow" };
}

export type AssetRouteResult =
  | "ok"
  | "not_found"
  | "has_maintenance_history"
  | "already_archived"
  | "not_archived"
  | "needs_migration";

export type AssetRouteHttp = {
  status: 200 | 404 | 409 | 503;
  body: { ok: true } | { error: string; code: Exclude<AssetRouteResult, "ok"> };
};

export function assetRouteResponse(result: AssetRouteResult): AssetRouteHttp {
  switch (result) {
    case "ok":
      return { status: 200, body: { ok: true } };
    case "not_found":
      return { status: 404, body: { error: "Asset not found.", code: result } };
    case "has_maintenance_history":
      return { status: 409, body: { error: ASSET_HAS_HISTORY_MESSAGE, code: result } };
    case "already_archived":
      return { status: 409, body: { error: "This asset is already archived.", code: result } };
    case "not_archived":
      return { status: 409, body: { error: "This asset is not archived.", code: result } };
    case "needs_migration":
      return { status: 503, body: { error: ASSET_NEEDS_MIGRATION_MESSAGE, code: result } };
  }
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npx vitest run lib/assets/errors.test.ts lib/assets/deleteRule.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/assets/errors.ts lib/assets/errors.test.ts lib/assets/deleteRule.ts lib/assets/deleteRule.test.ts
git commit -m "feat(assets): asset error messages and delete rule"
```

---

### Task 4: The `assets_01` migration

**Files:**
- Create: `docs/sql/assets_01_archive_and_office_writes.sql`
- Test: `lib/assets/officeFunctionSql.test.ts`

- [ ] **Step 1: Write the failing test `lib/assets/officeFunctionSql.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* assets_01 carries its own copy of pod_caller_is_office() so it can be
   applied before or after shifts_06. Two copies of a security check drift
   unless something fails when they do: this is that something. */

function readSql(file: string): string {
  return readFileSync(join(process.cwd(), "docs/sql", file), "utf8").replace(/\r\n/g, "\n");
}

function officeFunction(sql: string): string {
  const start = sql.indexOf("create or replace function public.pod_caller_is_office()");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("end $$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + "end $$;".length);
}

const assets = readSql("assets_01_archive_and_office_writes.sql");
const shifts = readSql("shifts_06_rectification_and_pod_guards.sql");

describe("assets_01", () => {
  it("carries a byte-identical pod_caller_is_office() to shifts_06", () => {
    expect(officeFunction(assets)).toBe(officeFunction(shifts));
  });

  it("keeps maintenance history when an asset is deleted", () => {
    expect(assets).toMatch(
      /foreign key \(asset_id\) references public\.assets\(id\) on delete restrict/,
    );
  });

  it("leaves the browser no way to delete assets", () => {
    expect(assets).toContain("revoke delete on public.assets from authenticated, anon;");
    expect(assets).not.toMatch(/create policy \w+ on public\.assets\s+for delete/);
  });

  it("guards the archive columns and archived rows", () => {
    expect(assets).toContain("errcode = 'AST01'");
    expect(assets).toContain("errcode = 'AST02'");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/assets/officeFunctionSql.test.ts`
Expected: FAIL, ENOENT for `assets_01_archive_and_office_writes.sql`.

- [ ] **Step 3: Create `docs/sql/assets_01_archive_and_office_writes.sql`**

The `pod_caller_is_office()` block below is copied verbatim from
`docs/sql/shifts_06_rectification_and_pod_guards.sql` lines 387 to 426. If the test in Step 4 fails on
the first assertion, re-copy that block from shifts_06 rather than editing either file by hand.

```sql
-- assets_01: archive columns, history-preserving maintenance link, office-only writes.
--
-- Spec: docs/superpowers/specs/2026-10-13-assets-phase-a-design.md
-- Apply by hand in the Supabase SQL editor. Independent of the prodfix series and of
-- shifts_06: it carries an identical pod_caller_is_office(), and
-- lib/assets/officeFunctionSql.test.ts fails if the two copies ever differ.
--
-- Before this file (live 2026-10-13): one FOR ALL policy, can_access_tenant(tenant_id), so any
-- tenant member including drivers could insert, update and DELETE assets from the browser, and
-- maintenance_records.asset_id was ON DELETE SET NULL, so a delete silently orphaned history.
--
-- After: drivers read only; office staff insert and update; nobody deletes from the browser
-- (DELETE /api/assets/[id], service role, admins only); archived_at / archived_by are written only
-- by the service role (POST /api/assets/[id]/archive and /restore); an archived row cannot be
-- edited until restored; the database refuses to delete an asset with maintenance history.
--
-- Error codes, mirrored in lib/assets/errors.ts:
--   AST01  a browser write touched archived_at / archived_by
--   AST02  a browser update hit an archived row

begin;

-- ===========================================================================
-- 1. Archive columns
-- ===========================================================================
alter table public.assets add column if not exists archived_at timestamptz null;
alter table public.assets add column if not exists archived_by uuid null
  references public.profiles(id) on delete set null;

-- ===========================================================================
-- 2. Maintenance history survives: SET NULL becomes RESTRICT
-- ===========================================================================
alter table public.maintenance_records drop constraint if exists maintenance_records_asset_id_fkey;
alter table public.maintenance_records add constraint maintenance_records_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete restrict;

-- ===========================================================================
-- 3. Office check (identical to shifts_06; either file may be applied first)
-- ===========================================================================
-- Mirrors lib/jobs/officeRoles.ts isOfficeCaller, except a NULL or empty role is refused.
-- SECURITY DEFINER so the driver-link lookup is not hidden by the caller's RLS; it answers only
-- about auth.uid() itself.
create or replace function public.pod_caller_is_office()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return false;
  end if;

  select lower(btrim(r.name)) into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = v_uid;

  if v_role in ('admin', 'super_admin') then
    return true;
  end if;
  if coalesce(v_role, '') = '' or v_role in ('driver', 'subcontractor_driver') then
    return false;
  end if;

  -- Same inputs as lib/jobs/officeAccess.ts hasActiveDriverLink.
  if exists (select 1 from public.driver_users du where du.user_id = v_uid and du.active is true) then
    return false;
  end if;
  if exists (select 1 from public.subcontractor_users su
                 where su.user_id = v_uid and su.active is true and su.role = 'driver') then
    return false;
  end if;

  return true;
end $$;

revoke all on function public.pod_caller_is_office() from public, anon;
grant execute on function public.pod_caller_is_office() to authenticated, service_role;

-- ===========================================================================
-- 4. Policies: read for members, write for office, delete for nobody
-- ===========================================================================
alter table public.assets enable row level security;

drop policy if exists tenant_access on public.assets;
drop policy if exists assets_select on public.assets;
drop policy if exists assets_insert on public.assets;
drop policy if exists assets_update on public.assets;

create policy assets_select on public.assets
  for select to authenticated
  using (public.can_access_tenant(tenant_id));

create policy assets_insert on public.assets
  for insert to authenticated
  with check (public.can_access_tenant(tenant_id) and public.pod_caller_is_office());

create policy assets_update on public.assets
  for update to authenticated
  using (public.can_access_tenant(tenant_id) and public.pod_caller_is_office())
  with check (public.can_access_tenant(tenant_id) and public.pod_caller_is_office());

revoke delete on public.assets from authenticated, anon;
revoke insert, update on public.assets from anon;

-- ===========================================================================
-- 5. Archive columns are server-only; archived rows are frozen
-- ===========================================================================
-- NOT security definer, deliberately: current_user must be the real caller.
create or replace function public.guard_asset_archive()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null then
      raise exception 'Assets are archived with the Archive button, not when they are created.'
        using errcode = 'AST01';
    end if;
    return new;
  end if;

  if old.archived_at is not null then
    raise exception 'This asset is archived. Restore it before editing.'
      using errcode = 'AST02';
  end if;

  if new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    raise exception 'Assets are archived and restored with the Archive and Restore buttons.'
      using errcode = 'AST01';
  end if;

  return new;
end $$;

revoke all on function public.guard_asset_archive() from public, anon, authenticated;

drop trigger if exists guard_asset_archive on public.assets;
create trigger guard_asset_archive
  before insert or update on public.assets
  for each row execute function public.guard_asset_archive();

commit;

-- ===========================================================================
-- VERIFY (read-only; run after the commit)
-- ===========================================================================
-- Expect 2 rows: archived_at, archived_by
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'assets'
  and column_name in ('archived_at', 'archived_by');

-- Expect 'r' (restrict)
select confdeltype from pg_constraint where conname = 'maintenance_records_asset_id_fkey';

-- Expect exactly assets_insert (INSERT), assets_select (SELECT), assets_update (UPDATE)
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'assets' order by policyname;

-- Expect false
select has_table_privilege('authenticated', 'public.assets', 'DELETE') as authenticated_can_delete;

-- Expect 1 row
select tgname from pg_trigger
where tgrelid = 'public.assets'::regclass and tgname = 'guard_asset_archive';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/assets/officeFunctionSql.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add docs/sql/assets_01_archive_and_office_writes.sql lib/assets/officeFunctionSql.test.ts
git commit -m "feat(sql): assets_01 archive columns, RESTRICT maintenance link, office-only writes"
```

---

### Task 5: Archive, restore and delete routes

**Files:**
- Create: `lib/assets/server.ts`
- Create: `app/api/assets/[id]/route.ts`, `app/api/assets/[id]/archive/route.ts`, `app/api/assets/[id]/restore/route.ts`
- Modify: `lib/auth/routeClassification.test.ts` (the `PROTECTED_ROUTES` array, after `"/api/accounts/statements",`)

- [ ] **Step 1: Make the route-classification test fail first**

In `lib/auth/routeClassification.test.ts`, inside `PROTECTED_ROUTES`, directly after the line
`  "/api/accounts/statements",` add:

```ts
  "/api/assets/[id]",
  "/api/assets/[id]/archive",
  "/api/assets/[id]/restore",
```

Run: `npx vitest run lib/auth/routeClassification.test.ts`
Expected: FAIL in "lists no route that no longer exists" (the three route files do not exist yet).

- [ ] **Step 2: Create `lib/assets/server.ts`**

```ts
/*
  Server-only: archive, restore and delete for /api/assets/**. Never import
  from client code (it pulls in the service-role client).

  Every action authorizes against the ASSET'S OWN tenant, read with the
  service role, never a tenant header: an admin on "All tenants" sends none,
  and the selector is not the row. Archive and restore need an office caller
  (drivers refused, lib/jobs/officeRoles.ts); delete needs can_manage_tenant.

  docs/sql/assets_01 makes the database agree: browser DELETE is revoked and
  the archive columns are writable only by the service role.
*/

import { createAdminClient, createUserClient } from "../accounts/server";
import { authorizeTenant, isUuid, TenantAccessError } from "../auth/serverTenantAccess";
import { authorizeOfficeTenant } from "../jobs/officeAccess";
import { assetRouteResponse, decideAssetDelete, type AssetRouteResult } from "./deleteRule";
import { isForeignKeyViolation, isMissingColumnError } from "./errors";

export type RouteAnswer = { status: number; body: Record<string, unknown> };

const SERVER_ERROR: RouteAnswer = {
  status: 500,
  body: { error: "Something went wrong. Please try again." },
};
const UNAUTHENTICATED: RouteAnswer = { status: 401, body: { error: "You must be signed in." } };
const FORBIDDEN: RouteAnswer = {
  status: 403,
  body: { error: "You do not have permission to change this asset." },
};

function answer(result: AssetRouteResult): RouteAnswer {
  const response = assetRouteResponse(result);
  return { status: response.status, body: response.body };
}

type AdminClient = ReturnType<typeof createAdminClient>;

type Authorized =
  | { ok: true; admin: AdminClient; userId: string; archivedAt: string | null }
  | { ok: false; answer: RouteAnswer };

async function authorizeAsset(
  id: string,
  level: "office" | "manage",
  withArchive: boolean,
): Promise<Authorized> {
  const userClient = await createUserClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) return { ok: false, answer: UNAUTHENTICATED };

  if (!isUuid(id)) return { ok: false, answer: answer("not_found") };

  const admin = createAdminClient();
  // Delete never reads the archive columns, so it still works before assets_01.
  const columns = withArchive ? "id, tenant_id, archived_at" : "id, tenant_id";
  const lookup = await admin.from("assets").select(columns).eq("id", id).maybeSingle();
  if (lookup.error) {
    if (withArchive && isMissingColumnError(lookup.error)) {
      return { ok: false, answer: answer("needs_migration") };
    }
    throw new Error(`asset lookup failed: ${lookup.error.message}`);
  }

  const row = lookup.data as unknown as { tenant_id?: string | null; archived_at?: string | null } | null;
  if (!row) return { ok: false, answer: answer("not_found") };

  const tenantId = row.tenant_id ?? null;
  if (!tenantId) return { ok: false, answer: FORBIDDEN };

  try {
    if (level === "office") {
      await authorizeOfficeTenant(admin, user.id, tenantId, "access");
    } else {
      await authorizeTenant(admin, user.id, tenantId, "manage");
    }
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 401) {
      return { ok: false, answer: UNAUTHENTICATED };
    }
    if (error instanceof TenantAccessError && error.status === 403) {
      return { ok: false, answer: FORBIDDEN };
    }
    throw error;
  }

  return { ok: true, admin, userId: user.id, archivedAt: row.archived_at ?? null };
}

/** POST /api/assets/[id]/archive (archive = true) and /restore (archive = false). */
export async function setAssetArchived(id: string, archive: boolean): Promise<RouteAnswer> {
  try {
    const auth = await authorizeAsset(id, "office", true);
    if (!auth.ok) return auth.answer;

    if (archive && auth.archivedAt) return answer("already_archived");
    if (!archive && !auth.archivedAt) return answer("not_archived");

    const patch = archive
      ? { archived_at: new Date().toISOString(), archived_by: auth.userId }
      : { archived_at: null, archived_by: null };

    // The archived_at condition makes a double click a 409, not a second write.
    const base = auth.admin.from("assets").update(patch).eq("id", id);
    const guarded = archive ? base.is("archived_at", null) : base.not("archived_at", "is", null);
    const { data, error } = await guarded.select("id");

    if (error) {
      if (isMissingColumnError(error)) return answer("needs_migration");
      throw new Error(`asset archive update failed: ${error.message}`);
    }
    if ((data ?? []).length === 0) return answer(archive ? "already_archived" : "not_archived");
    return answer("ok");
  } catch (error) {
    console.error(
      "Asset archive change failed",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return SERVER_ERROR;
  }
}

/** DELETE /api/assets/[id]: admins only, and only an asset with no history. */
export async function deleteAsset(id: string): Promise<RouteAnswer> {
  try {
    const auth = await authorizeAsset(id, "manage", false);
    if (!auth.ok) return auth.answer;

    const history = await auth.admin
      .from("maintenance_records")
      .select("asset_id", { count: "exact", head: true })
      .eq("asset_id", id);
    if (history.error) {
      throw new Error(`maintenance history check failed: ${history.error.message}`);
    }

    if (decideAssetDelete({ maintenanceRows: history.count ?? 0 }).kind === "refuse") {
      return answer("has_maintenance_history");
    }

    const removed = await auth.admin.from("assets").delete().eq("id", id).select("id");
    if (removed.error) {
      // A record added between the count and the delete: assets_01's RESTRICT refuses it.
      if (isForeignKeyViolation(removed.error)) return answer("has_maintenance_history");
      throw new Error(`asset delete failed: ${removed.error.message}`);
    }
    return answer((removed.data ?? []).length > 0 ? "ok" : "not_found");
  } catch (error) {
    console.error(
      "Asset delete failed",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return SERVER_ERROR;
  }
}
```

- [ ] **Step 3: Create `app/api/assets/[id]/route.ts`**

```ts
// Permanently delete one asset. Admins only; refused while it has maintenance
// history (archive it instead). Rules and contract: lib/assets/server.ts and
// lib/assets/deleteRule.ts.

import { NextRequest, NextResponse } from "next/server";
import { deleteAsset } from "../../../../lib/assets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await deleteAsset(id);
  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 4: Create `app/api/assets/[id]/archive/route.ts`**

```ts
// Archive one asset. Office callers only (drivers refused). See lib/assets/server.ts.

import { NextRequest, NextResponse } from "next/server";
import { setAssetArchived } from "../../../../../lib/assets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await setAssetArchived(id, true);
  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 5: Create `app/api/assets/[id]/restore/route.ts`**

```ts
// Restore one archived asset. Office callers only (drivers refused). See lib/assets/server.ts.

import { NextRequest, NextResponse } from "next/server";
import { setAssetArchived } from "../../../../../lib/assets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await setAssetArchived(id, false);
  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 6: Run the route classification test and typecheck**

Run: `npx vitest run lib/auth/routeClassification.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors. If `lookup.data` or the update builder complains about types, keep the
`as unknown as` cast on `row` and do not loosen anything else.

- [ ] **Step 7: Commit**

```bash
git add lib/assets/server.ts "app/api/assets" lib/auth/routeClassification.test.ts
git commit -m "feat(assets): archive, restore and admin-only delete routes"
```

---

### Task 6: Optional header sorting in `DataTable`

**Files:**
- Modify: `components/DataTable.tsx`

No vitest coverage (components are outside `lib/`); the ordering logic is already tested in
`lib/assets/register.test.ts`. `npm run typecheck` guards the existing callers.

- [ ] **Step 1: Extend the types**

In `components/DataTable.tsx`, add `ChevronDown, ChevronUp` from `lucide-react` to the imports:

```ts
import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../lib/cn";
import Skeleton from "./Skeleton";
```

Add `sortKey` to `Column<T>` (after `width`):

```ts
  /* Opt-in header sorting. The page owns the order: DataTable only renders the
     header as a button and reports clicks through onSortChange. */
  sortKey?: string;
```

Below `export type DataTableState ...` add:

```ts
export type TableSort = { key: string; direction: "asc" | "desc" };
```

Add to `Props<T>` (after `expandedKey`):

```ts
  /** Current order, for the header indicator and aria-sort. */
  sort?: TableSort;
  /** Called with a column's sortKey when its header is clicked. */
  onSortChange?: (key: string) => void;
```

Add `sort,` and `onSortChange,` to the destructured parameters after `expandedKey = null,`.

- [ ] **Step 2: Render sortable headers**

Replace the `<th>` mapping inside `<thead>` with:

```tsx
            {columns.map((col, i) => {
              const sortable = Boolean(col.sortKey && onSortChange);
              const active = sortable && sort?.key === col.sortKey;
              return (
                <th
                  key={`${col.header}-${i}`}
                  aria-sort={
                    active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn(
                    "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3",
                    col.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange?.(col.sortKey as string)}
                      className="inline-flex items-center gap-1 bg-transparent font-semibold uppercase tracking-wide text-ink-3 hover:text-ink"
                    >
                      {col.header}
                      {active ? (
                        sort?.direction === "asc" ? (
                          <ChevronUp size={12} aria-hidden />
                        ) : (
                          <ChevronDown size={12} aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (existing callers pass neither prop and render exactly as before).

- [ ] **Step 4: Commit**

```bash
git add components/DataTable.tsx
git commit -m "feat(ui): optional header sorting in DataTable"
```

---

### Task 7: Status badge, save helper and the asset dialog

**Files:**
- Create: `app/assets/StatusBadge.tsx`, `app/assets/saveAsset.ts`, `app/assets/AssetDialog.tsx`

- [ ] **Step 1: Create `app/assets/StatusBadge.tsx`**

```tsx
import Badge, { type Tone } from "../../components/Badge";
import { assetStatus, isArchived } from "../../lib/assets/register";
import { formatLabel, type Asset } from "../../lib/assets/types";

function statusTone(status: string): Tone {
  if (status === "inactive") return "danger";
  if (status === "maintenance") return "warning";
  return "success";
}

export default function StatusBadge({ asset }: { asset: Asset }) {
  const status = assetStatus(asset);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={statusTone(status)}>{formatLabel(status)}</Badge>
      {isArchived(asset) ? <Badge tone="neutral">Archived</Badge> : null}
    </span>
  );
}
```

- [ ] **Step 2: Create `app/assets/saveAsset.ts`**

```ts
/* Browser insert/update for /assets, moved out of the page with its behaviour
   unchanged, plus a zero-row check on update (an RLS-filtered UPDATE is not an
   error in Postgres, it just matches nothing). Throws Error(message) for the
   dialog to show. */

import type { createClient } from "../../lib/supabase/browser";
import { ASSET_NOT_UPDATED_MESSAGE, assetWriteMessage } from "../../lib/assets/errors";
import { buildAssetPayload, validateAssetForm } from "../../lib/assets/payload";
import type { Asset, AssetFormValues, AssetType } from "../../lib/assets/types";

type BrowserClient = ReturnType<typeof createClient>;

export async function saveAsset(input: {
  supabase: BrowserClient;
  values: AssetFormValues;
  /** The asset being edited, or null to add a new one. */
  editing: Asset | null;
  writeTenantId: string | null;
  assetTypes: readonly AssetType[];
}): Promise<"added" | "updated"> {
  const { supabase, values, editing, writeTenantId, assetTypes } = input;

  const check = validateAssetForm(values, assetTypes);
  if (!check.ok) throw new Error(check.error);

  /* An admin viewing "All tenants" has no write target, so a new asset would
     have nowhere to land. Editing an existing row is still fine: it is
     matched by id and scoped by the row's own tenant. */
  if (!editing && !writeTenantId) {
    throw new Error("Select a single tenant before adding an asset.");
  }

  const assetNumber = values.assetNumber.trim();

  /* The uniqueness rule is per tenant, so the check must be scoped to the
     tenant the row will live in, not to whatever is on screen: for an edit
     that is the row's existing tenant, for an insert the write target.
     Archived assets still hold their number. */
  const duplicateTenantId = editing ? editing.tenant_id : writeTenantId;

  let duplicateQuery = supabase.from("assets").select("id").eq("asset_number", assetNumber);
  if (duplicateTenantId) duplicateQuery = duplicateQuery.eq("tenant_id", duplicateTenantId);
  if (editing) duplicateQuery = duplicateQuery.neq("id", editing.id);

  const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1);
  if (duplicateError) throw new Error(assetWriteMessage(duplicateError));
  if ((duplicate ?? []).length > 0) {
    throw new Error("Another asset in this tenant already uses that asset number.");
  }

  const payload = buildAssetPayload(values, check.type);

  if (editing) {
    /* No tenant_id/company_id in the update: an edit must never repoint a
       row at another tenant, and RLS already decides which rows this id is
       allowed to match. */
    const { data, error } = await supabase
      .from("assets")
      .update(payload)
      .eq("id", editing.id)
      .select("id");
    if (error) throw new Error(assetWriteMessage(error));
    if ((data ?? []).length === 0) throw new Error(ASSET_NOT_UPDATED_MESSAGE);
    return "updated";
  }

  /* company_id comes from the TARGET TENANT, not from the tenant context.
     get_tenant_context() hands a super_admin every tenant in the platform
     while reporting their OWN company_id (rls_07), so stamping the context
     value would file another company's asset under the operator's company.
     Reading it off the tenants row is correct for all three roles, and RLS
     on `tenants` is what keeps this lookup honest. */
  const { data: tenantRow, error: tenantRowError } = await supabase
    .from("tenants")
    .select("company_id")
    .eq("id", writeTenantId)
    .maybeSingle();
  if (tenantRowError) throw new Error(assetWriteMessage(tenantRowError));
  if (!tenantRow?.company_id) {
    throw new Error(
      "That tenant is not linked to a company. Ask an administrator to complete the company assignment.",
    );
  }

  const { error } = await supabase.from("assets").insert({
    ...payload,
    tenant_id: writeTenantId,
    company_id: String(tenantRow.company_id),
  });
  if (error) throw new Error(assetWriteMessage(error));
  return "added";
}
```

- [ ] **Step 3: Create `app/assets/AssetDialog.tsx`**

```tsx
"use client";

import { type FormEvent, useState } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import Textarea from "../../components/Textarea";
import { isArchived } from "../../lib/assets/register";
import {
  ASSET_STATUSES,
  EMPTY_ASSET_FORM,
  IDENTIFIER_TYPES,
  defaultMechanical,
  formFromAsset,
  formatLabel,
  type Asset,
  type AssetFormValues,
  type AssetType,
} from "../../lib/assets/types";
import StatusBadge from "./StatusBadge";

const FORM_ID = "asset-form";

type Props = {
  /** null when adding a new asset. */
  asset: Asset | null;
  initialMode: "view" | "edit";
  assetTypes: AssetType[];
  canWrite: boolean;
  canDelete: boolean;
  archiveSupported: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: AssetFormValues) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

/* The page mounts this with a fresh `key` per open, so the form and the
   delete confirmation start clean every time without a reset effect. The
   server decides every action; the props here only hide buttons that would
   certainly be refused. */
export default function AssetDialog({
  asset,
  initialMode,
  assetTypes,
  canWrite,
  canDelete,
  archiveSupported,
  busy,
  error,
  onClose,
  onSave,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">(asset ? initialMode : "edit");
  const [values, setValues] = useState<AssetFormValues>(
    asset ? formFromAsset(asset) : EMPTY_ASSET_FORM,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const archived = asset ? isArchived(asset) : false;
  const confirmWord = asset ? asset.asset_number || asset.name : "";
  const title = !asset ? "Add asset" : mode === "edit" ? `Edit ${asset.name}` : asset.name;

  function set<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeType(assetTypeId: string) {
    const type = assetTypes.find((candidate) => candidate.id === assetTypeId);
    setValues((current) => ({
      ...current,
      assetTypeId,
      mechanical: type ? defaultMechanical(type.name) : current.mechanical,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onSave(values);
  }

  function cancelEdit() {
    if (!asset) {
      onClose();
      return;
    }
    setValues(formFromAsset(asset));
    setMode("view");
  }

  function cancelDelete() {
    setConfirmingDelete(false);
    setConfirmText("");
  }

  const footer =
    mode === "edit" ? (
      <>
        <Button variant="secondary" disabled={busy} onClick={cancelEdit}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID} disabled={busy}>
          {busy ? "Saving..." : asset ? "Save changes" : "Add asset"}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close
        </Button>
        {canWrite && archiveSupported ? (
          archived ? (
            <Button variant="secondary" disabled={busy} onClick={onRestore}>
              Restore
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={onArchive}>
              Archive
            </Button>
          )
        ) : null}
        {canDelete && !confirmingDelete ? (
          <Button variant="danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        ) : null}
        {canWrite ? (
          <Button disabled={busy || archived} onClick={() => setMode("edit")}>
            Edit
          </Button>
        ) : null}
      </>
    );

  return (
    <Modal open onClose={onClose} title={title} size="lg" footer={footer}>
      <MessageBanner tone="danger">{error}</MessageBanner>

      {mode === "view" && asset ? (
        <div className="grid gap-4">
          <AssetDetails asset={asset} />

          {archived && canWrite ? (
            <p className="m-0 text-sm text-ink-2">
              This asset is archived. Restore it to edit it.
            </p>
          ) : null}

          {confirmingDelete ? (
            <div className="grid gap-3 rounded-lg border-2 border-danger bg-danger-tint p-4">
              <p className="m-0 text-sm text-ink">
                Permanently delete this asset? This cannot be undone. Assets with maintenance
                history cannot be deleted; archive them instead.
              </p>
              <Field
                id="asset-delete-confirm"
                label={`Type ${confirmWord} to confirm`}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy || confirmText.trim() !== confirmWord}
                  onClick={onDelete}
                >
                  Delete permanently
                </Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={cancelDelete}>
                  Keep asset
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field
            id="asset-name"
            label="Asset Name"
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="e.g. Curtainsider Trailer 12"
            required
          />

          <Field
            id="asset-number"
            label="Asset Number"
            value={values.assetNumber}
            onChange={(event) => set("assetNumber", event.target.value)}
            placeholder="e.g. TRL-012"
            required
          />

          <Select
            id="asset-identifier-type"
            label="Identifier Type"
            value={values.identifierType}
            onChange={(event) => set("identifierType", event.target.value)}
          >
            {IDENTIFIER_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <Select
            id="asset-type"
            label="Asset Type"
            value={values.assetTypeId}
            onChange={(event) => changeType(event.target.value)}
            required
          >
            <option value="">Select asset type</option>
            {assetTypes.map((assetType) => (
              <option key={assetType.id} value={assetType.id}>
                {assetType.name}
              </option>
            ))}
          </Select>

          <Field
            id="asset-serial-number"
            label="Serial Number"
            value={values.serialNumber}
            onChange={(event) => set("serialNumber", event.target.value)}
            placeholder="Optional serial number"
          />

          <Field
            id="asset-barcode"
            label="Barcode"
            value={values.barcode}
            onChange={(event) => set("barcode", event.target.value)}
            placeholder="Scan or enter barcode"
          />

          <Select
            id="asset-status"
            label="Status"
            value={values.status}
            onChange={(event) => set("status", event.target.value)}
          >
            {ASSET_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
            <input
              type="checkbox"
              checked={values.mechanical}
              onChange={(event) => set("mechanical", event.target.checked)}
              className="mt-1"
            />
            <span className="min-w-0 text-sm text-ink">
              <strong className="font-semibold">Mechanical Asset</strong>
              <small className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-3">
                Mechanical assets can be linked to maintenance records.
              </small>
            </span>
          </label>

          <Textarea
            id="asset-notes"
            label="Notes"
            wrapperClassName="sm:col-span-2"
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Asset notes..."
            rows={4}
            className="resize-y"
          />
        </form>
      )}
    </Modal>
  );
}

function AssetDetails({ asset }: { asset: Asset }) {
  const rows: Array<[string, string]> = [
    ["Asset number", asset.asset_number || "Not set"],
    ["Type", asset.asset_type || "Not set"],
    ["Identifier type", formatLabel(asset.identifier_type || "internal")],
    ["Registration", asset.registration || "Not set"],
    ["Serial number", asset.serial_number || "Not set"],
    ["Barcode", asset.barcode || "Not set"],
    ["Mechanical", asset.mechanical ? "Yes, can be linked to maintenance records" : "No"],
  ];

  return (
    <div className="grid gap-4">
      <StatusBadge asset={asset} />

      <dl className="m-0 grid grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="mb-0.5 text-kicker uppercase text-ink-3">{label}</dt>
            <dd className="m-0 break-words text-sm font-semibold text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>

      {asset.notes ? (
        <div className="break-words rounded-md border border-line bg-surface-2 p-3 text-sm leading-relaxed text-ink-2">
          {asset.notes}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (The new files are not imported by the page yet; typecheck still compiles them.)

- [ ] **Step 5: Commit**

```bash
git add app/assets/StatusBadge.tsx app/assets/saveAsset.ts app/assets/AssetDialog.tsx
git commit -m "feat(assets): asset dialog, status badge and save helper"
```

---

### Task 8: Rewrite the page; remove the card grid

**Files:**
- Rewrite: `app/assets/page.tsx`
- Delete: `app/assets/AssetCard.tsx`, `app/assets/types.ts`

- [ ] **Step 1: Replace `app/assets/page.tsx` entirely**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import DataTable, { type Column, type DataTableState } from "../../components/DataTable";
import MessageBanner from "../../components/MessageBanner";
import SearchInput from "../../components/SearchInput";
import Select from "../../components/Select";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { isMissingColumnError } from "../../lib/assets/errors";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterAssets,
  hasActiveFilters,
  identifierSummary,
  isArchived,
  nextSort,
  sortAssets,
  type AssetFilters,
  type AssetSort,
  type MechanicalFilter,
  type SortKey,
  type StatusFilter,
} from "../../lib/assets/register";
import {
  ASSET_STATUSES,
  type Asset,
  type AssetFormValues,
  type AssetType,
} from "../../lib/assets/types";
import AssetDialog from "./AssetDialog";
import StatusBadge from "./StatusBadge";
import { saveAsset } from "./saveAsset";

const BASE_COLUMNS = `
  id,
  company_id,
  tenant_id,
  name,
  asset_type,
  asset_type_id,
  asset_number,
  identifier_type,
  reference,
  serial_number,
  registration,
  barcode,
  mechanical,
  status,
  notes,
  created_at
`;

/* docs/sql/assets_01 adds these. Without it the first select fails with 42703
   and the page reloads with BASE_COLUMNS and hides the archive controls. */
const ARCHIVE_COLUMNS = `${BASE_COLUMNS}, archived_at, archived_by`;

const COLUMNS: Column<Asset>[] = [
  {
    header: "Asset",
    sortKey: "name",
    cell: (asset) => <span className="font-semibold text-ink">{asset.name}</span>,
  },
  { header: "Number", sortKey: "number", cell: (asset) => asset.asset_number || "-" },
  { header: "Type", sortKey: "type", cell: (asset) => asset.asset_type || "-" },
  { header: "Identifier", cell: (asset) => identifierSummary(asset) || "-" },
  { header: "Status", sortKey: "status", cell: (asset) => <StatusBadge asset={asset} /> },
  {
    header: "Mechanical",
    sortKey: "mechanical",
    cell: (asset) => (asset.mechanical ? "Yes" : "No"),
  },
];

type DialogState = { key: number; assetId: string | null; mode: "view" | "edit" };

type AssetAction = "archive" | "restore" | "delete";

const ACTION_DONE: Record<AssetAction, string> = {
  archive: "Asset archived.",
  restore: "Asset restored.",
  delete: "Asset deleted.",
};

async function callAssetRoute(assetId: string, action: AssetAction): Promise<string | null> {
  const id = encodeURIComponent(assetId);
  const response = await fetch(
    action === "delete" ? `/api/assets/${id}` : `/api/assets/${id}/${action}`,
    { method: action === "delete" ? "DELETE" : "POST" },
  );
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "Something went wrong. Please try again.";
}

export default function AssetsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [assets, setAssets] = useState<Asset[]>([]);
  const loadSeqRef = useRef(0);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);

  const [loading, setLoading] = useState(true);
  // Distinct from `loading`: this stays true across refetches, so a token
  // refresh cannot flash a skeleton over the rows already on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  // The tenant the rows on screen were loaded FOR. See
  // lib/loading/skeletonVisibility.ts for why this is three-valued.
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [typeError, setTypeError] = useState("");
  const [archiveSupported, setArchiveSupported] = useState(true);

  /* useTenant() folds drivers into "staff", so ask the database. null means
     unknown (the function is not installed yet): show the controls and let
     RLS refuse, rather than hide them from office staff. */
  const [isOffice, setIsOffice] = useState<boolean | null>(null);

  const [filters, setFilters] = useState<AssetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<AssetSort>(DEFAULT_SORT);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogKeyRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [message, setMessage] = useState("");

  /* One region, one flag: the table is the only thing on this page that
     renders tenant data. The type <select>s feed form controls, which
     skeletonVisibility deliberately excludes. */
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const loadAssets = useCallback(async () => {
    if (tenant.status !== "ready") return;

    /* SET-18: latest request wins, so a slow response for the tenant the
       user just switched away from cannot replace the new list. */
    const seq = ++loadSeqRef.current;

    setLoading(true);

    const fetchAssets = (columns: string) =>
      tenant
        .filterByTenant(supabase.from("assets").select(columns))
        .order("created_at", { ascending: false });

    const [firstResult, typeResult] = await Promise.all([
      fetchAssets(ARCHIVE_COLUMNS),
      supabase.from("asset_types").select("id, name").order("name", { ascending: true }),
    ]);

    let assetResult = firstResult;
    let supported = true;
    if (firstResult.error && isMissingColumnError(firstResult.error)) {
      supported = false;
      assetResult = await fetchAssets(BASE_COLUMNS);
    }

    if (seq !== loadSeqRef.current) return;

    if (assetResult.error) {
      setLoadError(assetResult.error.message);
      setAssets([]);
    } else {
      setLoadError("");
      setAssets((assetResult.data as unknown as Asset[]) ?? []);
      setArchiveSupported(supported);
      setDataTenantId(tenant.activeTenantId);
    }

    if (typeResult.error) {
      setTypeError(typeResult.error.message);
      setAssetTypes([]);
    } else {
      setTypeError("");
      setAssetTypes((typeResult.data as AssetType[]) ?? []);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void loadAssets();
    // loadAssets is rebuilt on every tenant context change; depending on the
    // two fields that actually matter keeps this to one fetch per switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("pod_caller_is_office").then(({ data, error }) => {
      if (!cancelled) setIsOffice(error ? null : data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const visibleAssets = useMemo(
    () => sortAssets(filterAssets(assets, filters), sort),
    [assets, filters, sort],
  );
  const activeCount = useMemo(() => assets.filter((asset) => !isArchived(asset)).length, [assets]);
  const filtering = hasActiveFilters(filters);

  const canWrite = isOffice !== false;
  const canDelete = canWrite && (tenant.role === "admin" || tenant.role === "super_admin");
  const dialogAsset = dialog?.assetId
    ? (assets.find((asset) => asset.id === dialog.assetId) ?? null)
    : null;

  const tableState: DataTableState = showSkeleton
    ? "loading"
    : loadError
      ? "error"
      : visibleAssets.length === 0
        ? "empty"
        : "ready";

  function openDialog(assetId: string | null, mode: "view" | "edit") {
    setMessage("");
    setDialogError("");
    dialogKeyRef.current += 1;
    setDialog({ key: dialogKeyRef.current, assetId, mode });
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setDialogError("");
  }

  async function handleSave(values: AssetFormValues) {
    if (tenant.status !== "ready") {
      setDialogError("Your tenant connection is not available.");
      return;
    }

    setBusy(true);
    setDialogError("");

    try {
      const outcome = await saveAsset({
        supabase,
        values,
        editing: dialogAsset,
        writeTenantId: tenant.writeTenantId,
        assetTypes,
      });
      setDialog(null);
      setMessage(outcome === "added" ? "Asset added." : "Asset updated.");
      await loadAssets();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Unable to save asset.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action: AssetAction) {
    if (!dialogAsset) return;

    setBusy(true);
    setDialogError("");

    const failure = await callAssetRoute(dialogAsset.id, action).catch(
      () => "Network error. Check your connection and try again.",
    );

    setBusy(false);

    if (failure) {
      setDialogError(failure);
      return;
    }

    if (action === "delete") setDialog(null);
    setMessage(ACTION_DONE[action]);
    await loadAssets();
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-kicker uppercase text-ink-3">Fleet</div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Assets</h1>
              <p className="m-0 text-sm text-ink-3">
                Track trailers, containers, pallets, plant, machinery and equipment.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {showSkeleton ? null : (
                <Badge tone="neutral">
                  {activeCount} asset{activeCount === 1 ? "" : "s"}
                </Badge>
              )}
              {canWrite ? <Button onClick={() => openDialog(null, "edit")}>Add asset</Button> : null}
            </div>
          </header>

          <MessageBanner tone="danger">{typeError}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

          <div className="mb-3 flex flex-wrap items-end gap-3">
            <SearchInput
              id="asset-search"
              label="Search assets"
              value={filters.query}
              onChange={(query) => setFilters((current) => ({ ...current, query }))}
              placeholder="Search name, number, registration, serial or barcode"
              resultHint={filtering ? `${visibleAssets.length} of ${assets.length}` : undefined}
              wrapperClassName="mb-0 min-w-[260px] flex-1"
            />

            <Select
              id="asset-filter-type"
              label="Type"
              value={filters.typeId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, typeId: event.target.value }))
              }
            >
              <option value="">Any type</option>
              {assetTypes.map((assetType) => (
                <option key={assetType.id} value={assetType.id}>
                  {assetType.name}
                </option>
              ))}
            </Select>

            <Select
              id="asset-filter-status"
              label="Status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as StatusFilter,
                }))
              }
            >
              <option value="any">Any status</option>
              {ASSET_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <Select
              id="asset-filter-mechanical"
              label="Mechanical"
              value={filters.mechanical}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  mechanical: event.target.value as MechanicalFilter,
                }))
              }
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>

            {archiveSupported ? (
              <label className="flex h-10 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={filters.showArchived}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, showArchived: event.target.checked }))
                  }
                />
                Show archived
              </label>
            ) : null}

            {filtering ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setFilters((current) => ({ ...EMPTY_FILTERS, showArchived: current.showArchived }))
                }
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          <DataTable
            columns={COLUMNS}
            rows={visibleAssets}
            rowKey={(asset) => asset.id}
            state={tableState}
            skeletonRows={6}
            onRowClick={(asset) => openDialog(asset.id, "view")}
            sort={sort}
            onSortChange={(key) => setSort((current) => nextSort(current, key as SortKey))}
            errorMessage={loadError || undefined}
            onRetry={() => void loadAssets()}
            emptyTitle={assets.length === 0 ? "No assets yet" : "No assets match these filters"}
            emptyDescription={
              assets.length === 0
                ? "Add trailers, containers, pallets and equipment to start the register."
                : undefined
            }
            emptyAction={
              assets.length > 0 && filtering ? (
                <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />

          {dialog ? (
            <AssetDialog
              key={dialog.key}
              asset={dialogAsset}
              initialMode={dialog.mode}
              assetTypes={assetTypes}
              canWrite={canWrite}
              canDelete={canDelete}
              archiveSupported={archiveSupported}
              busy={busy}
              error={dialogError}
              onClose={closeDialog}
              onSave={(values) => void handleSave(values)}
              onArchive={() => void handleAction("archive")}
              onRestore={() => void handleAction("restore")}
              onDelete={() => void handleAction("delete")}
            />
          ) : null}
        </main>
      </div>
    </TenantGate>
  );
}
```

Note on "only archived assets exist and the toggle is off": `assets.length > 0` but `visibleAssets` is
empty and `filtering` is false, so the table shows "No assets match these filters" with no button.
That is acceptable; the "Show archived" toggle is right above it.

- [ ] **Step 2: Delete the replaced files**

```bash
git rm app/assets/AssetCard.tsx app/assets/types.ts
```

- [ ] **Step 3: Confirm nothing else imported them**

Run: `git grep -n "assets/AssetCard\|assets/types\"\|from \"./types\"" -- app`
Expected: no matches under `app/assets/`. (Other folders' own `./types` imports are unrelated.)

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck`
Expected: no errors. If `assetResult = await fetchAssets(BASE_COLUMNS)` is rejected as a different type
from `firstResult`, declare `let assetResult: Awaited<ReturnType<typeof fetchAssets>> = firstResult;`.

Run: `npm test`
Expected: all suites pass, including `lib/nav/themeableRoutes.test.ts` (no route was added or removed
from the page tree; `/assets` is already listed).

- [ ] **Step 5: Commit**

```bash
git add app/assets/page.tsx
git commit -m "feat(assets): table register with search, filters, sorting and asset dialog"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md` (the `/assets` line, currently line 115)
- Modify: `CLAUDE.md` (Architecture, after the "Deleting a vehicle goes through" bullet)
- Modify: `docs/sql/prodfix_00_APPLY_ORDER.md` (new section after "## Live state, 2026-10-08" block, before "## When to apply")

- [ ] **Step 1: README**

Replace the line

```
- **`/assets`** [OK]: trailers / pallets / equipment; create and list (no edit / delete yet).
```

with

```
- **`/assets`** [OK]: trailers / pallets / equipment; searchable, sortable register with type, status and mechanical filters; add and edit in a dialog; office staff archive and restore; admins permanently delete an asset that has no maintenance history. Drivers read only. Archive, restore and delete need `docs/sql/assets_01` (until it is applied the archive controls are hidden and those routes answer 503).
```

- [ ] **Step 2: CLAUDE.md**

After the bullet that starts `- **Deleting a vehicle goes through \`DELETE /api/vehicles/[id]\`**`, add:

```
- **Assets are archived, and deleted only through `DELETE /api/assets/[id]`.** `assets_01` makes
  `archived_at`/`archived_by` server-only (trigger, `AST01`), refuses browser edits to an archived row
  (`AST02`), limits asset insert and update to office callers (`pod_caller_is_office()`, a copy of the
  `shifts_06` function kept identical by `lib/assets/officeFunctionSql.test.ts`), revokes browser DELETE,
  and makes `maintenance_records.asset_id` RESTRICT so a delete can never orphan maintenance history.
  Archive and restore (`POST /api/assets/[id]/archive`, `/restore`) are office-only; delete is admin-only
  and answers 409 while maintenance history exists. Rules live in `lib/assets/`.
```

- [ ] **Step 3: Apply-order doc**

Insert before the line `## When to apply: SQL first, then deploy`:

```
## assets_01 (2026-10-13, not applied)

`assets_01_archive_and_office_writes.sql` is independent of the prodfix series and of shifts_06 (it
carries an identical `pod_caller_is_office()`), so it can be applied at any time. Run its VERIFY block
afterwards. Before it is applied, `/assets` hides the archive controls, the archive and restore routes
answer 503, delete still checks maintenance history first, and drivers can still write assets.

```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/sql/prodfix_00_APPLY_ORDER.md
git commit -m "docs: assets Phase A in README, CLAUDE.md and apply order"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: every suite passes. Record the totals.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds and lists `/api/assets/[id]`, `/api/assets/[id]/archive`, `/api/assets/[id]/restore`.

- [ ] **Step 4: Em-dash check on everything this branch touched**

Run: `git diff main --name-only | xargs grep -nP "\x{2014}"` (U+2014, the em-dash)
Expected: no matches in files this plan created. Pre-existing matches in files only lightly edited (README,
CLAUDE.md) are acceptable if they are not on lines this plan added.

- [ ] **Step 5: Hand back to Ethan with the manual checklist**

These need a signed-in browser and the migration applied, so they are Ethan's, not the executor's:

1. Apply `docs/sql/assets_01_archive_and_office_writes.sql` in the SQL editor and run its VERIFY block.
2. Admin: add, edit, archive, restore an asset; search and each filter; sort by each sortable column.
3. Admin: log a maintenance record against an asset, try to delete it (expect "This asset has maintenance
   history. Archive it instead."), then delete an asset with no history.
4. Office staff: archive works; Delete is not shown; a forced `fetch("/api/assets/<id>", { method: "DELETE" })`
   from the console answers 403.
5. Driver: no Add button; the dialog shows no Edit, Archive or Delete.
