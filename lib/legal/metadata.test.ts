import { describe, expect, it } from "vitest";
import { legalMetadata } from "./metadata";
import { LEGAL_DOCUMENTS } from "./routes";

describe("legalMetadata", () => {
  it("titles the page after the document", () => {
    expect(legalMetadata("/terms").title).toBe("Terms and Conditions | TMS Wizzard");
  });

  it("lets every page be indexed now that no placeholder is left", () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(legalMetadata(d.path).robots, d.path).toEqual({ index: true, follow: true });
    }
  });
});
