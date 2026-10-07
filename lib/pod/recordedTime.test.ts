import { describe, expect, it } from "vitest";
import { acceptRecordedTime, MAX_RECORDED_AGE_MS, MAX_RECORDED_FUTURE_MS } from "./recordedTime";

const now = new Date("2026-10-07T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("acceptRecordedTime", () => {
  it("trusts a recent time with no shift (subcontractor)", () => {
    const at = iso(now.getTime() - 60 * 60 * 1000);
    expect(acceptRecordedTime({ recordedAt: at, serverNow: now, shift: null })).toEqual({ at, trusted: true });
  });

  it("falls back to server time for garbage", () => {
    for (const recordedAt of [undefined, null, "", "yesterday", 42]) {
      expect(acceptRecordedTime({ recordedAt, serverNow: now, shift: null })).toEqual({ at: now.toISOString(), trusted: false });
    }
  });

  it("allows small future skew but refuses more", () => {
    const ok = iso(now.getTime() + MAX_RECORDED_FUTURE_MS);
    const bad = iso(now.getTime() + MAX_RECORDED_FUTURE_MS + 1);
    expect(acceptRecordedTime({ recordedAt: ok, serverNow: now, shift: null }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: bad, serverNow: now, shift: null })).toEqual({ at: now.toISOString(), trusted: false });
  });

  it("refuses a time older than the maximum age", () => {
    const ok = iso(now.getTime() - MAX_RECORDED_AGE_MS);
    const bad = iso(now.getTime() - MAX_RECORDED_AGE_MS - 1);
    expect(acceptRecordedTime({ recordedAt: ok, serverNow: now, shift: null }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: bad, serverNow: now, shift: null }).trusted).toBe(false);
  });

  it("requires the time to sit inside the named shift", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: "2026-10-07T10:00:00.000Z" };
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T06:00:00.000Z", serverNow: now, shift }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T10:00:00.000Z", serverNow: now, shift }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T05:59:59.999Z", serverNow: now, shift }).trusted).toBe(false);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T10:00:00.001Z", serverNow: now, shift }).trusted).toBe(false);
  });

  it("has no upper bound while the shift is still open", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: null };
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T11:59:00.000Z", serverNow: now, shift }).trusted).toBe(true);
  });

  it("normalises the accepted time to ISO", () => {
    const result = acceptRecordedTime({ recordedAt: "2026-10-07T11:00:00+01:00", serverNow: now, shift: null });
    expect(result).toEqual({ at: "2026-10-07T10:00:00.000Z", trusted: true });
  });

  it("falls back for a time with no offset or a date only", () => {
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T11:00:00", serverNow: now, shift: null }).trusted).toBe(false);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07", serverNow: now, shift: null }).trusted).toBe(false);
  });

  it("falls back when the named shift has an unparseable start", () => {
    const shift = { startedAt: "not a date", endedAt: null };
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T11:00:00.000Z", serverNow: now, shift }).trusted).toBe(false);
  });

  it("still refuses a future time while the shift is open", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: null };
    const future = iso(now.getTime() + MAX_RECORDED_FUTURE_MS + 1000);
    expect(acceptRecordedTime({ recordedAt: future, serverNow: now, shift }).trusted).toBe(false);
  });

  it("refuses a time before notBefore (the job did not exist yet), boundary inclusive", () => {
    const notBefore = "2026-10-07T10:00:00.000Z";
    expect(acceptRecordedTime({ recordedAt: notBefore, serverNow: now, shift: null, notBefore })).toEqual({ at: notBefore, trusted: true });
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T09:59:59.999Z", serverNow: now, shift: null, notBefore })).toEqual({ at: now.toISOString(), trusted: false });
  });

  it("applies notBefore together with the shift bounds", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: null };
    const notBefore = "2026-10-07T10:00:00.000Z";
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T08:00:00.000Z", serverNow: now, shift, notBefore }).trusted).toBe(false);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T11:00:00.000Z", serverNow: now, shift, notBefore }).trusted).toBe(true);
  });

  it("ignores a null notBefore and refuses when notBefore is unparseable", () => {
    const at = "2026-10-07T11:00:00.000Z";
    expect(acceptRecordedTime({ recordedAt: at, serverNow: now, shift: null, notBefore: null }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: at, serverNow: now, shift: null, notBefore: "garbage" }).trusted).toBe(false);
  });
});
