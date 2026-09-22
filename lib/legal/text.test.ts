import { describe, expect, it } from "vitest";
import { documentStatus, findPlaceholders, linkify, resolvePlaceholders, sectionId } from "./text";
import type { LegalDocumentContent } from "./types";
import { VENDOR, type Vendor } from "./vendor";

const FILLED: Vendor = { ...VENDOR, companyNumber: "01234567" };
const EMPTY: Vendor = { ...VENDOR, companyNumber: null };

function doc(texts: string[]): LegalDocumentContent {
  return {
    source: "test.pdf",
    slug: "test",
    title: "Test",
    company: [],
    versionLine: "Version 1.0.",
    intro: [],
    sections: [{ heading: "1. Only", blocks: texts.map((text) => ({ kind: "p" as const, runs: [{ text }] })) }],
  };
}

describe("resolvePlaceholders", () => {
  it("substitutes the vendor facts that are known", () => {
    expect(resolvePlaceholders("Company number [COMPANY NUMBER].", FILLED)).toBe("Company number 01234567.");
  });

  it("leaves an unknown fact as its placeholder, so the draft guard can see it", () => {
    expect(resolvePlaceholders("Company number [COMPANY NUMBER]", EMPTY)).toBe("Company number [COMPANY NUMBER]");
  });

  it("never substitutes a placeholder that is not a vendor fact", () => {
    expect(resolvePlaceholders("UK Addendum. [CONFIRM MECHANISM]", FILLED)).toBe("UK Addendum. [CONFIRM MECHANISM]");
  });
});

describe("findPlaceholders", () => {
  it("finds capitalised bracket placeholders", () => {
    expect(findPlaceholders("a [VAT NUMBER] b [CONFIRM TENANT REGION]")).toEqual(["[VAT NUMBER]", "[CONFIRM TENANT REGION]"]);
  });

  /* The Cookie Notice is full of these. Treating them as unresolved facts would
     pin that page in draft forever. */
  it("ignores the lower-case bracket tokens in cookie and storage key names", () => {
    expect(findPlaceholders("sb-[project]-auth-token tms:planning-draft:[depot]:[date]")).toEqual([]);
  });
});

describe("documentStatus", () => {
  it("is a draft while a vendor fact is missing", () => {
    expect(documentStatus(doc(["No [COMPANY NUMBER]", "again [COMPANY NUMBER]", "[CONFIRM REGION]"]), EMPTY)).toEqual({
      draft: true,
      unresolved: ["[COMPANY NUMBER]", "[CONFIRM REGION]"],
    });
  });

  it("stops being a draft once the vendor facts are filled in, with no flag to flip", () => {
    expect(documentStatus(doc(["No [COMPANY NUMBER]", "again [COMPANY NUMBER]"]), FILLED)).toEqual({ draft: false, unresolved: [] });
  });

  it("stays a draft for a fact only the source document can settle", () => {
    expect(documentStatus(doc(["IDTA. [CONFIRM MECHANISM]"]), FILLED)).toEqual({
      draft: true,
      unresolved: ["[CONFIRM MECHANISM]"],
    });
  });

  it("looks inside lists, tables, headings and the company block, not only paragraphs", () => {
    const d = doc([]);
    d.company = ["Registered: [COMPANY NUMBER]"];
    d.sections[0].blocks = [
      { kind: "ul", items: [[{ text: "item [ICO REFERENCE]" }]] },
      { kind: "table", head: ["Provider"], rows: [["Supabase [CONFIRM MECHANISM]"]] },
    ];
    expect(documentStatus(d, EMPTY).unresolved).toEqual(["[COMPANY NUMBER]", "[CONFIRM MECHANISM]", "[ICO REFERENCE]"]);
  });
});

describe("linkify", () => {
  it("links the exact title of another published document", () => {
    expect(linkify("See our Privacy Notice.", "/terms")).toEqual([
      { kind: "text", text: "See our " },
      { kind: "link", text: "Privacy Notice", href: "/privacy" },
      { kind: "text", text: "." },
    ]);
  });

  it("never links a document to itself", () => {
    expect(linkify("This Privacy Notice explains.", "/privacy")).toEqual([{ kind: "text", text: "This Privacy Notice explains." }]);
  });

  it("turns an email address into a mailto link and keeps the sentence full stop outside it", () => {
    expect(linkify("Email it@silverlady.group.", "/terms")).toEqual([
      { kind: "text", text: "Email " },
      { kind: "link", text: "it@silverlady.group", href: "mailto:it@silverlady.group" },
      { kind: "text", text: "." },
    ]);
  });

  it("handles several links in one sentence, in order", () => {
    const segments = linkify(
      "These Terms, with the Cancellation and Refund Policy, Data Processing Agreement, Acceptable Use Policy and Service Level and Support Policy, are the entire agreement.",
      "/terms",
    );
    expect(segments.filter((s) => s.kind === "link").map((s) => (s.kind === "link" ? s.href : ""))).toEqual([
      "/cancellation-policy",
      "/dpa",
      "/acceptable-use",
      "/support-policy",
    ]);
    expect(segments.map((s) => s.text).join("")).toContain("are the entire agreement.");
  });

  /* Internal documents are mentioned by name in the public ones. They have no
     page, so they must stay plain text and not become dead links. */
  it("does not link documents that are not published", () => {
    expect(linkify("See our Data Retention Schedule and Data Breach Response Procedure.", "/terms")).toEqual([
      { kind: "text", text: "See our Data Retention Schedule and Data Breach Response Procedure." },
    ]);
  });

  it("does not guess at loose references", () => {
    expect(linkify("the Terms and our security overview", "/dpa")).toEqual([{ kind: "text", text: "the Terms and our security overview" }]);
  });

  it("always reproduces the original text exactly", () => {
    const text = "Our Sub-processor List, the Security Overview and it@silverlady.group";
    expect(linkify(text, "/dpa").map((s) => s.text).join("")).toBe(text);
  });
});

describe("sectionId", () => {
  it("makes a stable anchor from a heading", () => {
    expect(sectionId("9. Cooling-off, cancellation and refunds")).toBe("9-cooling-off-cancellation-and-refunds");
    expect(sectionId("Annex 1: Categories of Customer Personal Data")).toBe("annex-1-categories-of-customer-personal-data");
  });
});
