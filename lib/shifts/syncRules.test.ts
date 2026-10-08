import { describe, expect, it } from "vitest";
import { correctedFieldPolicy, occurrenceCheck } from "./syncRules";

const receivedAt = new Date("2026-09-29T12:00:00Z");

describe("occurrenceCheck", () => {
  it("accepts a recent in-order event with no flags", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-29T11:59:00Z", receivedAt, previousOccurredAt: "2026-09-29T11:00:00Z" })).toEqual({ ok: true, flags: [] });
  });

  it("allows five minutes of phone clock skew, refuses beyond", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-29T12:04:00Z", receivedAt, previousOccurredAt: null }).ok).toBe(true);
    expect(occurrenceCheck({ occurredAt: "2026-09-29T12:06:00Z", receivedAt, previousOccurredAt: null })).toEqual({
      ok: false,
      error: "The event time is in the future. Check the phone's clock.",
    });
  });

  it("flags events older than 72 hours and events before the previous one", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-26T11:00:00Z", receivedAt, previousOccurredAt: null })).toEqual({ ok: true, flags: ["late_sync"] });
    expect(occurrenceCheck({ occurredAt: "2026-09-29T11:50:00Z", receivedAt, previousOccurredAt: "2026-09-29T11:55:00Z" })).toEqual({ ok: true, flags: ["out_of_order"] });
  });

  it("flags an event sent more than 15 minutes after it was recorded as delayed (S-6)", () => {
    expect(occurrenceCheck({ occurredAt: "2026-09-29T11:45:00Z", receivedAt, previousOccurredAt: null })).toEqual({ ok: true, flags: [] });
    expect(occurrenceCheck({ occurredAt: "2026-09-29T11:44:00Z", receivedAt, previousOccurredAt: null })).toEqual({ ok: true, flags: ["delayed_sync"] });
    expect(occurrenceCheck({ occurredAt: "2026-09-29T08:30:00Z", receivedAt, previousOccurredAt: "2026-09-29T09:00:00Z" })).toEqual({ ok: true, flags: ["delayed_sync", "out_of_order"] });
  });

  it("refuses an unparseable time", () => {
    expect(occurrenceCheck({ occurredAt: "yesterday", receivedAt, previousOccurredAt: null }).ok).toBe(false);
  });
});

describe("correctedFieldPolicy", () => {
  it("lets office corrections win", () => {
    expect(correctedFieldPolicy(new Set(["ended_at"]), "ended_at")).toBe("attach_flagged");
    expect(correctedFieldPolicy(new Set(["started_at"]), "ended_at")).toBe("apply");
  });
});
