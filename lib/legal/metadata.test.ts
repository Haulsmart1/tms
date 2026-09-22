import { describe, expect, it } from "vitest";
import { legalMetadata } from "./metadata";
import { LEGAL_DOCUMENTS } from "./routes";

describe("legalMetadata", () => {
  it("titles the page after the document", () => {
    expect(legalMetadata("/terms").title).toBe("Terms and Conditions | TMS Wizzard");
  });

  /* Every document still carries [VAT NUMBER] today, so every page must be
     noindex. When lib/legal/vendor.ts is filled in and the Sub-processor List
     is settled, this expectation flips: change it then. */
  it("keeps a draft document out of search indexes", () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(legalMetadata(d.path).robots, d.path).toEqual({ index: false, follow: true });
    }
  });
});
