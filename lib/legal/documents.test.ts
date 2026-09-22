import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COOLING_OFF_HOURS } from "../billing/cancellation";
import { DISCOUNT_BANDS, PERIOD_DAYS, PERIOD_MINIMUM_PENCE, PERIOD_VEHICLE_PENCE, fleetPeriodPence } from "../billing/rateCard";
import { VAT_RATE_PERCENT, vatOnNetPence } from "../billing/vat";
import { allLegalDocuments, getLegalDocument } from "./documents";
import { LEGAL_DOCUMENTS } from "./routes";
import { documentStatus, documentTexts, sectionId } from "./text";
import type { LegalBlock } from "./types";
import { VENDOR } from "./vendor";

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;

describe("legal document registry", () => {
  it("has content for every listed document, under the same title", () => {
    for (const meta of LEGAL_DOCUMENTS) {
      expect(getLegalDocument(meta.path).content.title, meta.path).toBe(meta.title);
    }
  });

  it("has no content file that is not listed", () => {
    const files = readdirSync(join(__dirname, "content")).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(allLegalDocuments().map((d) => `${d.content.slug}.json`).sort());
  });

  it("throws on an unregistered path", () => {
    expect(() => getLegalDocument("/not-a-policy")).toThrow();
  });

  /* The internal documents (publication checklist, GDPR policy, DSAR, retention
     and breach procedures) must never be converted into public content. */
  it("publishes none of the internal documents", () => {
    const sources = allLegalDocuments().map((d) => d.content.source);
    for (const source of sources) expect(source).toMatch(/^(0[1-9]|10)-/);
    expect(sources).toHaveLength(10);
  });
});

describe("legal document content shape", () => {
  const blocksOf = (d: ReturnType<typeof getLegalDocument>): LegalBlock[] => [
    ...d.content.intro,
    ...d.content.sections.flatMap((s) => s.blocks),
  ];

  it("contains only well-formed, non-empty blocks", () => {
    for (const d of allLegalDocuments()) {
      expect(d.content.sections.length, d.path).toBeGreaterThan(0);
      expect(d.content.versionLine, d.path).toMatch(/^Version \d+\.\d+\. /);
      for (const block of blocksOf(d)) {
        if (block.kind === "p") {
          expect(block.runs.map((r) => r.text).join("").trim(), d.path).not.toBe("");
        } else if (block.kind === "ul") {
          expect(block.items.length, d.path).toBeGreaterThan(0);
          for (const item of block.items) expect(item.map((r) => r.text).join("").trim(), d.path).not.toBe("");
        } else {
          expect(block.kind, d.path).toBe("table");
          expect(block.head, d.path).not.toBeNull();
          for (const row of block.rows) expect(row.length, d.path).toBe(block.head?.length);
        }
      }
    }
  });

  it("gives every section a unique anchor within its document", () => {
    for (const d of allLegalDocuments()) {
      const ids = d.content.sections.map((s) => sectionId(s.heading));
      expect(new Set(ids).size, d.path).toBe(ids.length);
    }
  });

  /* A narrow PDF table column can split a word ("corres pondence"). The
     converter patches the known cases; this catches the cookie-name family of
     them coming back after a regeneration. */
  it("has no broken cookie or storage key names", () => {
    const text = documentTexts(getLegalDocument("/cookies").content).join("\n");
    expect(text).toContain("xero_oauth_state");
    expect(text).toContain("xero_oauth_tenant");
    expect(text).toContain("tms:planning-draft:[depot]:[date]");
    expect(text).not.toMatch(/\[\w+ \]|\[\w+ \w+\]:|_ _/);
  });

  it("carries no em-dashes", () => {
    for (const d of allLegalDocuments()) expect(documentTexts(d.content).join("\n"), d.path).not.toContain(String.fromCharCode(8212));
  });
});

describe("vendor identity", () => {
  it("matches the company block printed at the top of every document", () => {
    expect(VENDOR.companyNumber).toBe("14798586");
    for (const d of allLegalDocuments()) {
      expect(d.content.company, d.path).toEqual([
        `${VENDOR.legalName}, trading as ${VENDOR.tradingName}`,
        ...VENDOR.addressLines,
        "Registered in England & Wales: [COMPANY NUMBER]",
        "VAT number: [VAT NUMBER]",
        `Email: ${VENDOR.email}`,
      ]);
    }
  });

  /* Not a to-do list to silence: this is the record of what still blocks
     publication. When a fact is filled in, delete it here. When every list is
     empty the pages stop showing their draft notice by themselves. */
  it("records exactly which facts are still unresolved, per document", () => {
    const vendorFacts = ["[VAT NUMBER]"];
    const expected: Record<string, string[]> = Object.fromEntries(LEGAL_DOCUMENTS.map((d) => [d.path, vendorFacts]));
    expected["/privacy"] = ["[ICO REFERENCE]", "[VAT NUMBER]"];
    expected["/sub-processors"] = ["[CONFIRM MECHANISM]", "[CONFIRM TENANT REGION]", "[VAT NUMBER]"];

    const actual = Object.fromEntries(allLegalDocuments().map((d) => [d.path, documentStatus(d.content).unresolved]));
    expect(actual).toEqual(expected);
  });
});

/* The Terms and the Cancellation Policy quote prices and windows that the
   billing code enforces. If someone changes the rate card, these fail until the
   published documents are reissued (with 30 days' notice, per Terms 17.1). */
describe("published figures match the billing code", () => {
  const terms = documentTexts(getLegalDocument("/terms").content).join("\n");
  const cancellation = documentTexts(getLegalDocument("/cancellation-policy").content).join("\n");

  it("quotes the v2 unit price, minimum and period length", () => {
    expect(terms).toContain(`${pounds(PERIOD_VEHICLE_PENCE)}, charged for the days the vehicle was licensed in the period`);
    expect(terms).toContain(`${pounds(PERIOD_MINIMUM_PENCE)}, which includes your first 2 vehicles`);
    expect(terms).toContain(`Minimum charge per ${PERIOD_DAYS}-day period`);
    expect(2 * PERIOD_VEHICLE_PENCE).toBe(PERIOD_MINIMUM_PENCE);
  });

  it("quotes every whole-fleet discount step", () => {
    const table = getLegalDocument("/terms")
      .content.sections.flatMap((s) => s.blocks)
      .find((b) => b.kind === "table");
    const discountRows = table?.kind === "table" ? table.rows.filter((r) => r[0].startsWith("Whole-fleet discount")) : [];
    expect(discountRows).toEqual(
      DISCOUNT_BANDS.filter((b) => b.discountPercent > 0).map((b) => [
        `Whole-fleet discount, ${b.threshold} or more vehicles`,
        `${b.discountPercent}%`,
      ]),
    );
  });

  it("is right that 19 and 20 vehicles cost the same per period (Terms 6.3)", () => {
    expect(terms).toContain("19 vehicles and 20 vehicles cost the same per period");
    expect(fleetPeriodPence(19)).toBe(fleetPeriodPence(20));
  });

  it("quotes the VAT rate and the gross cooling-off refund", () => {
    expect(terms).toContain(`(currently ${VAT_RATE_PERCENT}%)`);
    const gross = PERIOD_MINIMUM_PENCE + vatOnNetPence(PERIOD_MINIMUM_PENCE);
    expect(cancellation).toContain(`(${pounds(gross)} at the current VAT rate)`);
  });

  it("quotes the cooling-off window the cancellation code enforces", () => {
    expect(terms).toContain(`${COOLING_OFF_HOURS}-hour cooling-off.`);
    expect(cancellation).toContain(`If you cancel within ${COOLING_OFF_HOURS} hours of your first payment`);
  });
});
