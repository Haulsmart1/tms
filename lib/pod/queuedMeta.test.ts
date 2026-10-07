import { describe, expect, it } from "vitest";
import { hasInvalidClientId, parseQueuedMeta } from "./queuedMeta";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseQueuedMeta", () => {
  it("is null for a body from a page that does not queue", () => {
    expect(parseQueuedMeta({ recipient_name: "x" })).toBeNull();
    expect(parseQueuedMeta(null)).toBeNull();
  });

  it("reads all three fields", () => {
    expect(parseQueuedMeta({ clientId: A, shiftClientId: B, recordedAt: "2026-10-07T10:00:00.000Z" })).toEqual({
      clientId: A,
      shiftClientId: B,
      recordedAt: "2026-10-07T10:00:00.000Z",
    });
  });

  it("keeps recordedAt as given (acceptance is decided later) and drops malformed ids", () => {
    expect(parseQueuedMeta({ clientId: "nope", shiftClientId: 7, recordedAt: "garbage" })).toEqual({
      clientId: null,
      shiftClientId: null,
      recordedAt: "garbage",
    });
  });

  it("treats a body with only clientId as queued", () => {
    expect(parseQueuedMeta({ clientId: A })).toEqual({ clientId: A, shiftClientId: null, recordedAt: null });
  });
});

describe("hasInvalidClientId", () => {
  it("flags a present but malformed clientId only", () => {
    expect(hasInvalidClientId({ clientId: "nope" }, parseQueuedMeta({ clientId: "nope" }))).toBe(true);
    expect(hasInvalidClientId({ clientId: 5 }, parseQueuedMeta({ clientId: 5 }))).toBe(true);
    expect(hasInvalidClientId({ clientId: A }, parseQueuedMeta({ clientId: A }))).toBe(false);
    expect(hasInvalidClientId({ recordedAt: "x" }, parseQueuedMeta({ recordedAt: "x" }))).toBe(false);
    expect(hasInvalidClientId({}, null)).toBe(false);
  });
});
