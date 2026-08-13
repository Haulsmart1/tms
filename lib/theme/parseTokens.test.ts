import { describe, it, expect } from "vitest";
import { parseTokenBlocks } from "./parseTokens";

const SAMPLE = `
/* a comment mentioning --canvas: #BADBAD; which must be ignored */
:root {
  --canvas: #0F1626;
  --surface: #161F31;   --surface-2: #131B2B;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55);
}
.light {
  --canvas: #F2F4F8;
  --surface: #FFFFFF;   --surface-2: #EDF0F5;
  --shadow-sm: 0 1px 2px rgba(11,18,32,.05);
}
:focus-visible { outline: 2px solid var(--focus); }
`;

describe("parseTokenBlocks", () => {
  it("extracts custom properties per selector", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--canvas"]).toBe("#0F1626");
    expect(blocks[".light"]["--canvas"]).toBe("#F2F4F8");
  });

  it("handles several declarations on one line, which tokens.css uses throughout", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--surface"]).toBe("#161F31");
    expect(blocks[":root"]["--surface-2"]).toBe("#131B2B");
  });

  it("keeps multi-part values such as shadows intact", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--shadow-sm"]).toBe(
      "0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55)",
    );
  });

  it("ignores custom properties that appear inside comments", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--canvas"]).not.toBe("#BADBAD");
  });

  it("ignores blocks that declare no custom properties", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":focus-visible"]).toBeUndefined();
  });
});
