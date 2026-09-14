import { describe, expect, it } from "vitest";
import { canEditQuotationContent, checkQuotationTransition } from "./quotationStatus";

describe("checkQuotationTransition", () => {
  it("never lets a member set accepted", () => {
    expect(checkQuotationTransition("draft", "accepted").ok).toBe(false);
    expect(checkQuotationTransition("sent", "accepted").ok).toBe(false);
  });

  it("blocks reverting an accepted quotation (INV-4)", () => {
    expect(checkQuotationTransition("accepted", "draft").ok).toBe(false);
    expect(checkQuotationTransition("accepted", "sent").ok).toBe(false);
  });

  it("keeps declined, expired, cancelled and converted terminal", () => {
    for (const from of ["declined", "expired", "cancelled", "converted"]) {
      expect(checkQuotationTransition(from, "draft").ok).toBe(false);
    }
  });

  it("allows the ordinary manual moves", () => {
    expect(checkQuotationTransition("draft", "sent").ok).toBe(true);
    expect(checkQuotationTransition("sent", "declined").ok).toBe(true);
    expect(checkQuotationTransition("draft", "cancelled").ok).toBe(true);
  });

  it("treats a same-status write as a no-op", () => {
    expect(checkQuotationTransition("sent", "sent").ok).toBe(true);
    expect(checkQuotationTransition("accepted", "accepted").ok).toBe(true);
  });
});

describe("canEditQuotationContent", () => {
  it("allows draft and sent only", () => {
    expect(canEditQuotationContent("draft").ok).toBe(true);
    expect(canEditQuotationContent("sent").ok).toBe(true);
    expect(canEditQuotationContent("accepted").ok).toBe(false);
    expect(canEditQuotationContent(null).ok).toBe(false);
  });
});
