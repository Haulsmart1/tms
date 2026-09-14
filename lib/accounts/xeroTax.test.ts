import { describe, expect, it } from "vitest";
import {
  expectedGrossTotal,
  parseTaxTypeMap,
  resolveXeroTaxType,
  totalsAgree,
  type XeroTaxRateInfo,
} from "./xeroTax";

const ukRates: XeroTaxRateInfo[] = [
  { TaxType: "OUTPUT2", Status: "ACTIVE", EffectiveRate: 20, CanApplyToRevenue: true },
  { TaxType: "RROUTPUT", Status: "ACTIVE", EffectiveRate: 5, CanApplyToRevenue: true },
  { TaxType: "ZERORATEDOUTPUT", Status: "ACTIVE", EffectiveRate: 0, CanApplyToRevenue: true },
  { TaxType: "EXEMPTOUTPUT", Status: "ACTIVE", EffectiveRate: 0, CanApplyToRevenue: true },
  { TaxType: "INPUT2", Status: "ACTIVE", EffectiveRate: 20, CanApplyToRevenue: false },
  { TaxType: "OLD", Status: "DELETED", EffectiveRate: 17.5, CanApplyToRevenue: true },
];

describe("resolveXeroTaxType", () => {
  it("uses the default code when its rate matches", () => {
    expect(resolveXeroTaxType({ vatRate: 20, explicitMap: {}, defaultTaxType: "OUTPUT2", taxRates: ukRates })).toEqual({
      ok: true,
      taxType: "OUTPUT2",
    });
  });

  it("does not apply a 20% default to a 0% line (the ACC-6 bug)", () => {
    const result = resolveXeroTaxType({ vatRate: 0, explicitMap: {}, defaultTaxType: "OUTPUT2", taxRates: ukRates });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Several");
  });

  it("uses an explicit mapping for an ambiguous rate", () => {
    expect(
      resolveXeroTaxType({
        vatRate: 0,
        explicitMap: { "0": "ZERORATEDOUTPUT" },
        defaultTaxType: "OUTPUT2",
        taxRates: ukRates,
      }),
    ).toEqual({ ok: true, taxType: "ZERORATEDOUTPUT" });
  });

  it("refuses an explicit mapping to the wrong rate", () => {
    expect(
      resolveXeroTaxType({ vatRate: 0, explicitMap: { "0": "OUTPUT2" }, defaultTaxType: null, taxRates: ukRates }).ok,
    ).toBe(false);
  });

  it("picks the unique revenue rate", () => {
    expect(resolveXeroTaxType({ vatRate: 5, explicitMap: {}, defaultTaxType: "OUTPUT2", taxRates: ukRates })).toEqual({
      ok: true,
      taxType: "RROUTPUT",
    });
    expect(resolveXeroTaxType({ vatRate: 20, explicitMap: {}, defaultTaxType: null, taxRates: ukRates })).toEqual({
      ok: true,
      taxType: "OUTPUT2",
    });
  });

  it("refuses a rate with no active match", () => {
    expect(resolveXeroTaxType({ vatRate: 17.5, explicitMap: {}, defaultTaxType: null, taxRates: ukRates }).ok).toBe(
      false,
    );
  });
});

describe("parseTaxTypeMap", () => {
  it("keeps only numeric keys with string values", () => {
    expect(parseTaxTypeMap({ xeroTaxTypes: { "0": "ZERORATEDOUTPUT", abc: "X", "5": 3 } })).toEqual({
      "0": "ZERORATEDOUTPUT",
    });
    expect(parseTaxTypeMap(null)).toEqual({});
  });
});

describe("reconciliation", () => {
  it("computes a line-rounded gross", () => {
    expect(
      expectedGrossTotal([
        { quantity: 1, unitPrice: 1000, vatRate: 0 },
        { quantity: 3, unitPrice: 33.333, vatRate: 20 },
      ]),
    ).toBe(1120);
  });

  it("tolerates a penny per line and no more", () => {
    expect(totalsAgree(1200, 1200.02, 2)).toBe(true);
    expect(totalsAgree(1000, 1200, 2)).toBe(false);
  });
});
