/*
  Per-line VAT mapping and total reconciliation for Xero invoice sync (review ACC-6).

  Xero recomputes tax from each line's TaxType, so posting every line with one
  default code books the wrong VAT for zero-rated, exempt or mixed invoices. Each
  line's vat_rate is resolved to a TaxType in this order:
    1. an explicit mapping in accounting_integrations.settings.xeroTaxTypes
       (for example {"0": "ZERORATEDOUTPUT"}), which must name an active Xero
       tax rate with that effective rate;
    2. the integration's default tax code, when its effective rate matches;
    3. the single active revenue tax rate in Xero with that effective rate.
  Anything else (no match, or several candidates such as the 0% zero-rated,
  exempt and no-VAT codes) refuses the sync rather than guessing.
*/

export type XeroTaxRateInfo = {
  TaxType?: string | null;
  Name?: string | null;
  Status?: string | null;
  EffectiveRate?: number | string | null;
  CanApplyToRevenue?: boolean | null;
};

export type TaxResolution = { ok: true; taxType: string } | { ok: false; message: string };

const RATE_EPSILON = 0.001;

function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < RATE_EPSILON;
}

function activeRate(rate: XeroTaxRateInfo): number | null {
  if (String(rate.Status ?? "").toUpperCase() !== "ACTIVE") return null;
  if (rate.EffectiveRate === null || rate.EffectiveRate === undefined || rate.EffectiveRate === "") return null;
  const value = Number(rate.EffectiveRate);
  return Number.isFinite(value) ? value : null;
}

export function parseTaxTypeMap(settings: unknown): Record<string, string> {
  if (!settings || typeof settings !== "object") return {};
  const raw = (settings as Record<string, unknown>).xeroTaxTypes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [rate, taxType] of Object.entries(raw as Record<string, unknown>)) {
    if (rate.trim() !== "" && Number.isFinite(Number(rate)) && typeof taxType === "string" && taxType.trim()) {
      result[rate] = taxType.trim();
    }
  }
  return result;
}

export function resolveXeroTaxType(input: {
  vatRate: number;
  explicitMap: Record<string, string>;
  defaultTaxType: string | null;
  taxRates: readonly XeroTaxRateInfo[];
}): TaxResolution {
  const { vatRate, explicitMap, taxRates } = input;
  const label = `${vatRate}%`;

  if (!Number.isFinite(vatRate) || vatRate < 0) {
    return { ok: false, message: "An invoice line has an invalid VAT rate." };
  }

  const byType = new Map<string, XeroTaxRateInfo>();
  for (const rate of taxRates) {
    if (rate.TaxType) byType.set(rate.TaxType, rate);
  }

  const explicitKey = Object.keys(explicitMap).find((key) => sameRate(Number(key), vatRate));
  if (explicitKey !== undefined) {
    const taxType = explicitMap[explicitKey];
    const rate = byType.get(taxType);
    const effective = rate ? activeRate(rate) : null;
    if (effective === null || !sameRate(effective, vatRate)) {
      return {
        ok: false,
        message: `The Xero tax mapping for ${label} points at ${taxType}, which is not an active ${label} tax rate in Xero.`,
      };
    }
    return { ok: true, taxType };
  }

  const defaultType = input.defaultTaxType?.trim() || null;
  if (defaultType) {
    const rate = byType.get(defaultType);
    const effective = rate ? activeRate(rate) : null;
    if (effective !== null && sameRate(effective, vatRate)) {
      return { ok: true, taxType: defaultType };
    }
  }

  const candidates = taxRates.filter((rate) => {
    const effective = activeRate(rate);
    return (
      effective !== null && sameRate(effective, vatRate) && rate.CanApplyToRevenue !== false && Boolean(rate.TaxType)
    );
  });

  if (candidates.length === 1) {
    return { ok: true, taxType: String(candidates[0].TaxType) };
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      message: `No active Xero tax rate matches ${label}. Add one in Xero, or map ${label} in the accounting settings.`,
    };
  }

  return {
    ok: false,
    message: `Several Xero tax rates match ${label} (${candidates
      .map((candidate) => candidate.TaxType)
      .join(", ")}). Map ${label} to one of them in the accounting settings.`,
  };
}

export type ReconcileLine = { quantity: number; unitPrice: number; vatRate: number };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Line-rounded gross total, the way the invoice lines are priced. */
export function expectedGrossTotal(lines: readonly ReconcileLine[]): number {
  return round2(
    lines.reduce((sum, line) => {
      const net = round2(line.quantity * line.unitPrice);
      return sum + net + round2(net * (line.vatRate / 100));
    }, 0),
  );
}

/** Rounding tolerance: one penny per line, at least one penny. */
export function totalsAgree(a: number, b: number, lineCount: number): boolean {
  const tolerance = Math.max(1, lineCount) * 0.01 + 1e-9;
  return Math.abs(round2(a) - round2(b)) <= tolerance;
}
