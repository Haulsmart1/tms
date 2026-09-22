/* Pure text handling for the policy pages: placeholder substitution, the draft
   guard, cross-links between documents and section anchors. No React and no
   document content, so all of it is unit tested (vitest only collects lib/). */

import { LEGAL_DOCUMENTS } from "./routes";
import type { LegalBlock, LegalDocumentContent } from "./types";
import { VENDOR, VENDOR_PLACEHOLDERS, type Vendor } from "./vendor";

/* An unresolved fact in a document: square brackets around capitals, such as
   [VAT NUMBER]. Capitals only, because the Cookie Notice legitimately contains
   lower-case bracketed tokens such as sb-[project]-auth-token. */
const PLACEHOLDER = /\[[A-Z][A-Z ]*[A-Z]\]/g;

/** Swaps in the vendor facts that are known. An unknown fact is left as its
    placeholder so that the draft guard below can see it. */
export function resolvePlaceholders(text: string, vendor: Vendor = VENDOR): string {
  return text.replace(PLACEHOLDER, (match) => {
    const field = VENDOR_PLACEHOLDERS[match];
    if (!field) return match;
    return vendor[field] ?? match;
  });
}

export function findPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

function blockTexts(blocks: readonly LegalBlock[]): string[] {
  return blocks.flatMap((block) => {
    if (block.kind === "p") return [block.runs.map((r) => r.text).join("")];
    if (block.kind === "ul") return block.items.map((item) => item.map((r) => r.text).join(""));
    return [...(block.head ?? []), ...block.rows.flat()];
  });
}

/** Every piece of text in a document, in reading order. */
export function documentTexts(doc: LegalDocumentContent): string[] {
  return [
    doc.title,
    ...doc.company,
    doc.versionLine,
    ...blockTexts(doc.intro),
    ...doc.sections.flatMap((s) => [s.heading, ...blockTexts(s.blocks)]),
  ];
}

export type DocumentStatus = {
  /** True while any placeholder survives substitution. A draft page shows a
      notice and is served noindex. Computed rather than flagged, so it lifts by
      itself when the facts are filled in and cannot be left on by mistake. */
  draft: boolean;
  /** The distinct placeholders still unresolved, sorted. */
  unresolved: string[];
};

export function documentStatus(doc: LegalDocumentContent, vendor: Vendor = VENDOR): DocumentStatus {
  const found = new Set<string>();
  for (const text of documentTexts(doc)) {
    for (const placeholder of findPlaceholders(resolvePlaceholders(text, vendor))) found.add(placeholder);
  }
  const unresolved = [...found].sort();
  return { draft: unresolved.length > 0, unresolved };
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Longest title first, so "Service Level and Support Policy" is never beaten
   to a match by a shorter title that happens to sit inside a longer one. */
const LINK_PATTERN = new RegExp(
  [
    ...[...LEGAL_DOCUMENTS].sort((a, b) => b.title.length - a.title.length).map((d) => escapeRegExp(d.title)),
    EMAIL.source,
  ].join("|"),
  "g",
);

const PATH_BY_TITLE = new Map(LEGAL_DOCUMENTS.map((d) => [d.title, d.path]));

/** Splits text into plain and linked segments. The exact title of another
    published document links to its page, and an email address becomes a mailto
    link. A document never links to itself. Matching is case-sensitive and
    whole-title only: "the Terms" and "our security overview" stay plain text,
    because guessing at loose references in a contract is worse than not
    linking them. */
export function linkify(text: string, currentPath: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const value = match[0];
    const start = match.index ?? 0;
    const path = PATH_BY_TITLE.get(value);
    const href = path ?? `mailto:${value}`;
    if (path === currentPath) continue;

    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({ kind: "link", text: value, href });
    last = start + value.length;
  }

  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** A stable anchor id for a section heading: "9. Cooling-off, cancellation and
    refunds" becomes "9-cooling-off-cancellation-and-refunds". */
export function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
