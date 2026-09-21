/* The vendor's legal identity, as it appears on the policy pages and in the
   landing footer.

   THREE FACTS ARE STILL UNKNOWN and are null on purpose. The policy documents
   carry them as square-bracket placeholders, and lib/legal/text.ts substitutes
   the values below at render time, so filling in these three constants
   completes every page at once. While any placeholder is unresolved the page
   shows a draft notice and is served noindex (see documentStatus in text.ts).

   Do NOT put 14798586 in companyNumber: the publication checklist
   (docs/TMS POLICIES/00-Publication-Checklist.pdf) records that number as
   belonging to ADR Carriers Limited, not to Silver Lady Holdings Ltd.

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
  companyNumber: null,
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
