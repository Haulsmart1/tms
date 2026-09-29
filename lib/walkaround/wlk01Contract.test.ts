import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RETURN_BLOCKED_ERRCODE, RETURN_BLOCKED_MESSAGE } from "./vor";

/*
  The WLK01 trigger in docs/sql/shifts_03_triggers.sql raises a sentence that
  lib/walkaround/vor.ts recognises verbatim (isReturnBlockedError falls back to
  matching the message). If the two drift, a blocked return to service shows a
  generic error instead of the reason.
*/
const sql = readFileSync(join(process.cwd(), "docs/sql/shifts_03_triggers.sql"), "utf8");

describe("WLK01 contract between shifts_03 and vor.ts", () => {
  const match = /raise exception '((?:[^']|'')*)'\s*using errcode = 'WLK01'/m.exec(sql);

  it("finds the WLK01 raise in the trigger", () => {
    expect(match).not.toBeNull();
    expect(RETURN_BLOCKED_ERRCODE).toBe("WLK01");
  });

  it("raises exactly RETURN_BLOCKED_MESSAGE", () => {
    expect(match?.[1].replace(/''/g, "'")).toBe(RETURN_BLOCKED_MESSAGE);
  });
});
