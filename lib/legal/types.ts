/* The shape scripts/legal/convert-policies.py writes into
   lib/legal/content/*.json. Keep the two in step. */

export type LegalRun = {
  text: string;
  bold?: boolean;
};

export type LegalBlock =
  | { kind: "p"; runs: LegalRun[] }
  | { kind: "ul"; items: LegalRun[][] }
  | { kind: "table"; head: string[] | null; rows: string[][] };

export type LegalSection = {
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDocumentContent = {
  /** The PDF in docs/TMS POLICIES/ this was generated from. */
  source: string;
  slug: string;
  title: string;
  /** The identity block printed at the top of every document. */
  company: string[];
  /** For example "Version 1.0. Effective September 2026." */
  versionLine: string;
  intro: LegalBlock[];
  sections: LegalSection[];
};
