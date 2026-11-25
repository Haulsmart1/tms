import { z } from "zod";
import { isValidYmd } from "./dates";
import { calculateLineAmounts, calculateTotals } from "./money";

const decimal = /^\d{1,7}(?:\.\d{1,2})?$/;
const positiveDecimal = z.string().regex(decimal).refine((value) => Number(value) > 0);

const invoiceLines = z.array(z.object({
  description: z.string().trim().min(1).max(300),
  quantity: positiveDecimal,
  unitPrice: positiveDecimal,
  vat: z.enum(["none", "0", "5", "20"]),
})).min(1).max(25);

export function parseSelfBillingDetails(supplyDate: FormDataEntryValue | null, rawLines: FormDataEntryValue | null) {
  if (!isValidYmd(supplyDate)) return { error: "Enter a valid supply date." } as const;
  let value: unknown;
  try {
    if (typeof rawLines !== "string" || rawLines.length > 16000) throw new Error();
    value = JSON.parse(rawLines);
  } catch {
    return { error: "Enter at least one valid invoice line." } as const;
  }
  const result = invoiceLines.safeParse(value);
  if (!result.success) {
    return { error: "Enter 1–25 lines with a description, positive quantity and price, and a VAT treatment." } as const;
  }
  const amounts = result.data.map(({ description, quantity, unitPrice, vat }) => {
    const vatRate = vat === "none" ? 0 : Number(vat);
    return { description, quantity: Number(quantity), unitPrice: Number(unitPrice), vatRate,
      treatment: vat, ...calculateLineAmounts(quantity, unitPrice, vatRate) };
  });
  const totals = calculateTotals(amounts);
  if (amounts.some((line) => line.netPence <= 0) || totals.total > 9_999_999.99) {
    return { error: "Each line must be worth at least £0.01 and the invoice total must be below £10 million." } as const;
  }

  return {
    supplyDate: supplyDate.trim(),
    usesVat: amounts.some((line) => line.treatment !== "none"),
    totals,
    lines: amounts.map(({ description, quantity, unitPrice, vatRate, net, treatment, gross, vat }) => ({
      description, quantity, unitPrice, vatRate, netAmount: net, vatAmount: vat, grossAmount: gross,
      ...(treatment === "none" ? { vatLabel: "No VAT" } : {}),
    })),
  } as const;
}
