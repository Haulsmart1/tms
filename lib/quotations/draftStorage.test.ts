import { describe, expect, it } from "vitest";
import {
  QUOTATION_DRAFT_TTL_MS,
  parseQuotationDraft,
  quotationDraftKey,
  serialiseQuotationDraft,
  staleQuotationDraftKeys,
} from "./draftStorage";

const NOW = new Date("2026-09-14T12:00:00Z");
const DRAFT = { customerId: "c1", notes: "Contact: J. Smith\nPhone: 07700 900000" };

function fakeStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  };
}

describe("parseQuotationDraft", () => {
  it("round-trips a fresh draft", () => {
    expect(parseQuotationDraft(serialiseQuotationDraft(DRAFT, NOW), NOW)).toEqual(DRAFT);
  });

  it("discards a draft older than the TTL", () => {
    const saved = new Date(NOW.getTime() - QUOTATION_DRAFT_TTL_MS - 1);
    expect(parseQuotationDraft(serialiseQuotationDraft(DRAFT, saved), NOW)).toBeNull();
  });

  it("keeps a draft just inside the TTL", () => {
    const saved = new Date(NOW.getTime() - QUOTATION_DRAFT_TTL_MS + 1000);
    expect(parseQuotationDraft(serialiseQuotationDraft(DRAFT, saved), NOW)).toEqual(DRAFT);
  });

  it("discards legacy drafts with no timestamp, malformed JSON and far-future timestamps", () => {
    expect(parseQuotationDraft(JSON.stringify(DRAFT), NOW)).toBeNull();
    expect(parseQuotationDraft("{not json", NOW)).toBeNull();
    expect(parseQuotationDraft(null, NOW)).toBeNull();
    const future = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(parseQuotationDraft(serialiseQuotationDraft(DRAFT, future), NOW)).toBeNull();
    expect(parseQuotationDraft(JSON.stringify({ version: 1, savedAt: NOW.toISOString(), draft: [] }), NOW)).toBeNull();
  });
});

describe("staleQuotationDraftKeys", () => {
  it("returns expired and unreadable draft keys for any tenant, and nothing else", () => {
    const old = new Date(NOW.getTime() - QUOTATION_DRAFT_TTL_MS - 1);
    const storage = fakeStorage({
      [quotationDraftKey("fresh")]: serialiseQuotationDraft(DRAFT, NOW),
      [quotationDraftKey("old")]: serialiseQuotationDraft(DRAFT, old),
      [quotationDraftKey("legacy")]: JSON.stringify(DRAFT),
      "tms-theme": "light",
    });

    expect(staleQuotationDraftKeys(storage, NOW).sort()).toEqual(
      [quotationDraftKey("legacy"), quotationDraftKey("old")].sort()
    );
  });
});
