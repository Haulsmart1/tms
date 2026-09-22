/* The vendor's legal identity, as it appears on the policy pages and in the
   landing footer.

   The documents carry the company number as a [COMPANY NUMBER] placeholder
   and lib/legal/text.ts substitutes the value below at render time. Should a
   placeholder ever be left unresolved (a null here, or a new bracketed note in
   a reissued PDF), the page shows a draft notice and is served noindex (see
   documentStatus in text.ts).

   companyNumber: the publication checklist
   (docs/TMS POLICIES/00-Publication-Checklist.pdf) warned that 14798586 is
   ADR Carriers Limited's number. On 2026-09-22 Ethan confirmed the vendor's
   facts are the same as ADR Carriers' originals, so the number is used. That
   means Companies House should list 14798586 under the trading entity named
   here; if it still shows "ADR Carriers Limited", legalName is what needs
   correcting, not the number.

   There is deliberately no VAT number or ICO reference. Neither appears in
   any ADR Carriers original, so on 2026-09-22 Ethan had the sentences that
   would carry them trimmed out of the documents (TRIMS in
   scripts/legal/convert-policies.py). If either is added later, restore the
   wording in the source PDFs, drop the trim, and add the field and its
   placeholder here.

   The name, address and email here must match the company block at the top of
   each document; lib/legal/documents.test.ts asserts that they do. */

export type Vendor = {
  legalName: string;
  tradingName: string;
  addressLines: readonly string[];
  email: string;
  /** Companies House number for Silver Lady Holdings Ltd. */
  companyNumber: string | null;
};

export const VENDOR: Vendor = {
  legalName: "Silver Lady Holdings Ltd",
  tradingName: "TMSWizzard",
  addressLines: ["Church View, Newton Arlosh", "Wigton, Cumbria, CA7 5ET"],
  email: "it@silverlady.group",
  companyNumber: "14798586",
};

/** Placeholder text in the documents, mapped to the vendor field that fills it.
    A placeholder not listed here is a fact to settle in the source document,
    not a value to substitute, and keeps the page in draft. */
export const VENDOR_PLACEHOLDERS: Readonly<Record<string, keyof Pick<Vendor, "companyNumber">>> = {
  "[COMPANY NUMBER]": "companyNumber",
};
