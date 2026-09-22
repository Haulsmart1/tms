/* The vendor's legal identity, as it appears on the policy pages and in the
   landing footer.

   TWO FACTS ARE STILL UNKNOWN and are null on purpose. The policy documents
   carry them as square-bracket placeholders, and lib/legal/text.ts substitutes
   the values below at render time, so filling in these constants completes
   every page at once. While any placeholder is unresolved the page shows a
   draft notice and is served noindex (see documentStatus in text.ts).

   companyNumber: the publication checklist
   (docs/TMS POLICIES/00-Publication-Checklist.pdf) warned that 14798586 is
   ADR Carriers Limited's number. On 2026-09-22 Ethan confirmed the vendor's
   facts are the same as ADR Carriers' originals, so the number is used. That
   means Companies House should list 14798586 under the trading entity named
   here; if it still shows "ADR Carriers Limited", legalName is what needs
   correcting, not the number.

   vatNumber and icoReference appear in none of the ADR Carriers originals
   (GDPR policy, retention schedule, breach procedure, subcontractor terms) and
   have to come from the VAT certificate and the ICO register.

   The name, address and email here must match the company block at the top of
   each document; lib/legal/documents.test.ts asserts that they do. */

export type Vendor = {
  legalName: string;
  tradingName: string;
  addressLines: readonly string[];
  email: string;
  /** Companies House number for Silver Lady Holdings Ltd. */
  companyNumber: string | null;
  /** Also has to appear on receipts or VAT invoices (handoff section 12, item 7). */
  vatNumber: string | null;
  /** ICO data protection fee registration reference. */
  icoReference: string | null;
};

export const VENDOR: Vendor = {
  legalName: "Silver Lady Holdings Ltd",
  tradingName: "TMSWizzard",
  addressLines: ["Church View, Newton Arlosh", "Wigton, Cumbria, CA7 5ET"],
  email: "it@silverlady.group",
  companyNumber: "14798586",
  vatNumber: null,
  icoReference: null,
};

/** Placeholder text in the documents, mapped to the vendor field that fills it.
    Placeholders not listed here ([CONFIRM MECHANISM], [CONFIRM TENANT REGION])
    are facts to settle in the source document, not values to substitute. */
export const VENDOR_PLACEHOLDERS: Readonly<Record<string, keyof Pick<Vendor, "companyNumber" | "vatNumber" | "icoReference">>> = {
  "[COMPANY NUMBER]": "companyNumber",
  "[VAT NUMBER]": "vatNumber",
  "[ICO REFERENCE]": "icoReference",
};
