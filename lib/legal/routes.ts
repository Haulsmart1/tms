/* The public legal and policy pages: their paths, titles and one-line
   summaries, and nothing else.

   This file deliberately imports NO document content. shouldShowShell() uses
   isLegalPath() inside the client shell, and lib/legal/text.ts uses the titles
   to cross-link documents, so anything imported here ships to every console
   page. The text itself lives in lib/legal/content/*.json and is reached
   through lib/legal/documents.ts, which only the legal pages import.

   Adding a page means: a row here, a JSON file from
   scripts/legal/convert-policies.py, an entry in lib/legal/documents.ts, an
   app/<path>/page.tsx, and the path in lib/auth/publicRoutes.ts,
   lib/auth/routeClassification.test.ts and lib/nav/themeableRoutes.ts.
   lib/legal/routes.test.ts fails until all of those agree.

   Documents 00 and 11 to 14 in docs/TMS POLICIES/ are internal and are NOT
   listed, on purpose. See docs/superpowers/specs/2026-09-21-policy-pages-design.md. */

export type LegalDocumentMeta = {
  /** Route path, and the key everything else is looked up by. */
  path: string;
  /** Must equal the title inside the document's JSON (asserted by a test),
      because text.ts links other documents' mentions of it. */
  title: string;
  /** Shown on the /legal index. Page chrome, not legal text. */
  summary: string;
};

export const LEGAL_INDEX_PATH = "/legal";

export const LEGAL_DOCUMENTS: readonly LegalDocumentMeta[] = [
  {
    path: "/terms",
    title: "Terms and Conditions",
    summary: "The agreement between your business and us: the service, prices, payment, cancellation and liability.",
  },
  {
    path: "/privacy",
    title: "Privacy Notice",
    summary: "How we use personal data where we are the controller: accounts, billing, enquiries and security logs.",
  },
  {
    path: "/cookies",
    title: "Cookie Notice",
    summary: "What is stored on your device. Strictly necessary cookies and storage only, with no analytics or advertising.",
  },
  {
    path: "/cancellation-policy",
    title: "Cancellation and Refund Policy",
    summary: "How to cancel, the 48-hour cooling-off refund, and what you are charged if you cancel later.",
  },
  {
    path: "/dpa",
    title: "Data Processing Agreement",
    summary: "The UK GDPR Article 28 terms that apply when we process the operational data you load.",
  },
  {
    path: "/accessibility",
    title: "Accessibility Statement",
    summary: "Where the service meets WCAG 2.2 AA, the known gaps, and how to ask for an adjustment.",
  },
  {
    path: "/support-policy",
    title: "Service Level and Support Policy",
    summary: "Availability, planned maintenance, support hours and response targets.",
  },
  {
    path: "/acceptable-use",
    title: "Acceptable Use Policy",
    summary: "The rules every user of a customer account must follow.",
  },
  {
    path: "/sub-processors",
    title: "Sub-processor List",
    summary: "The third parties that process personal data for the service, and where.",
  },
  {
    path: "/security",
    title: "Security Overview",
    summary: "The technical and organisational measures that protect your data.",
  },
];

export const LEGAL_DOCUMENT_PATHS: readonly string[] = LEGAL_DOCUMENTS.map((d) => d.path);

/** Every legal route, index included. */
export const LEGAL_PATHS: readonly string[] = [LEGAL_INDEX_PATH, ...LEGAL_DOCUMENT_PATHS];

export function isLegalPath(pathname: string): boolean {
  return LEGAL_PATHS.includes(pathname);
}
