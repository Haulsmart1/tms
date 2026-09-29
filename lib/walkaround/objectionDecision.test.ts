import { describe, expect, it } from "vitest";
import { MIN_REJECTION_NOTE, REJECTION_NOTE_MESSAGE, decisionNoteError } from "./objectionDecision";

describe("decisionNoteError", () => {
  it("needs a note of at least three characters to reject", () => {
    expect(MIN_REJECTION_NOTE).toBe(3);
    expect(decisionNoteError("reject", null)).toBe(REJECTION_NOTE_MESSAGE);
    expect(decisionNoteError("reject", "  ok  ")).toBe(REJECTION_NOTE_MESSAGE);
    expect(decisionNoteError("reject", "Brake light still out")).toBeNull();
    expect(decisionNoteError("reject", "abc")).toBeNull();
  });

  it("leaves the note optional when approving", () => {
    expect(decisionNoteError("approve", null)).toBeNull();
    expect(decisionNoteError("approve", "")).toBeNull();
  });
});
