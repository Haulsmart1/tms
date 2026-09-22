/* The policy documents themselves, keyed by route path.

   Only the legal pages import this file: it pulls in all ten documents' text.
   Anything that needs just the paths or titles imports lib/legal/routes.ts.

   The JSON is generated verbatim from the PDFs in docs/TMS POLICIES/ by
   scripts/legal/convert-policies.py. Do not edit the JSON by hand to change
   wording: change the source document and regenerate, so the PDF a customer
   was sent and the page they read cannot drift apart. */

import acceptableUse from "./content/acceptable-use.json";
import accessibility from "./content/accessibility.json";
import cancellationPolicy from "./content/cancellation-policy.json";
import cookies from "./content/cookies.json";
import dpa from "./content/dpa.json";
import privacy from "./content/privacy.json";
import security from "./content/security.json";
import subProcessors from "./content/sub-processors.json";
import supportPolicy from "./content/support-policy.json";
import terms from "./content/terms.json";
import { LEGAL_DOCUMENTS, type LegalDocumentMeta } from "./routes";
import type { LegalDocumentContent } from "./types";

/* JSON modules infer `kind` as string, not as the literal union, so each
   import is widened through unknown once, here. lib/legal/documents.test.ts
   checks the real shape of every block at test time instead. */
const CONTENT_BY_PATH: Readonly<Record<string, LegalDocumentContent>> = {
  "/terms": terms as unknown as LegalDocumentContent,
  "/privacy": privacy as unknown as LegalDocumentContent,
  "/cookies": cookies as unknown as LegalDocumentContent,
  "/cancellation-policy": cancellationPolicy as unknown as LegalDocumentContent,
  "/dpa": dpa as unknown as LegalDocumentContent,
  "/accessibility": accessibility as unknown as LegalDocumentContent,
  "/support-policy": supportPolicy as unknown as LegalDocumentContent,
  "/acceptable-use": acceptableUse as unknown as LegalDocumentContent,
  "/sub-processors": subProcessors as unknown as LegalDocumentContent,
  "/security": security as unknown as LegalDocumentContent,
};

export type LegalDocument = LegalDocumentMeta & { content: LegalDocumentContent };

/** Throws on an unknown path: every caller passes a literal, so a miss is a
    wiring mistake and should fail the build, not render an empty page. */
export function getLegalDocument(path: string): LegalDocument {
  const meta = LEGAL_DOCUMENTS.find((d) => d.path === path);
  const content = CONTENT_BY_PATH[path];
  if (!meta || !content) throw new Error(`No legal document is registered for ${path}`);
  return { ...meta, content };
}

export function allLegalDocuments(): LegalDocument[] {
  return LEGAL_DOCUMENTS.map((d) => getLegalDocument(d.path));
}
