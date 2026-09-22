import type { Metadata } from "next";
import { getLegalDocument } from "./documents";
import { documentStatus } from "./text";

/* Page metadata for one policy document. A document that still carries an
   unresolved placeholder is served noindex, so a search engine never caches a
   contract with "[VAT NUMBER]" in it. Like the on-page draft notice, this is
   computed from the content and lifts by itself. */
export function legalMetadata(path: string): Metadata {
  const doc = getLegalDocument(path);
  const { draft } = documentStatus(doc.content);

  return {
    title: `${doc.title} | TMS Wizzard`,
    description: doc.summary,
    robots: draft ? { index: false, follow: true } : { index: true, follow: true },
  };
}
