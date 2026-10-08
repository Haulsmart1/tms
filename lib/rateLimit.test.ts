import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "./rateLimit";
import { REQUEST_ACCESS_PER_EMAIL } from "./auth/leadIntake";

/* The signup limits are pinned to the lead-form level on purpose: an accepted
   signup mints an auth user and sends an email, so it must not be as loose as
   login. If either number changes, the spec's justification changes with it
   (docs/superpowers/specs/2026-09-16-self-serve-signup-design.md). */
describe("RATE_LIMITS for self-serve signup", () => {
  it("limits signups per IP at the request-access level", () => {
    expect(RATE_LIMITS.signupPerIp).toEqual({ bucket: "signup:ip", windowSeconds: 3600, max: 5 });
    expect(RATE_LIMITS.signupPerIp.max).toBe(RATE_LIMITS.requestAccessPerIp.max);
    expect(RATE_LIMITS.signupPerIp.windowSeconds).toBe(RATE_LIMITS.requestAccessPerIp.windowSeconds);
  });

  it("limits signups per email at the request-access level", () => {
    expect(RATE_LIMITS.signupPerEmail).toEqual({ bucket: "signup:email", windowSeconds: 86400, max: 3 });
    expect(RATE_LIMITS.signupPerEmail.max).toBe(REQUEST_ACCESS_PER_EMAIL.max);
    expect(RATE_LIMITS.signupPerEmail.windowSeconds).toBe(REQUEST_ACCESS_PER_EMAIL.windowSeconds);
  });

  it("uses buckets no other rule shares", () => {
    const buckets = Object.values(RATE_LIMITS).map((rule) => rule.bucket);
    expect(new Set(buckets).size).toBe(buckets.length);
  });
});

describe("RATE_LIMITS for driver GPS (N-9)", () => {
  it("allows the tracker's full offline backlog plus normal sending in one window", () => {
    expect(RATE_LIMITS.driverLocation).toEqual({ bucket: "driver-location:user", windowSeconds: 600, max: 120 });
    // One fix per 15 s for ten minutes (40) plus a 40-fix backlog stays inside the limit.
    expect(600 / 15 + 40).toBeLessThanOrEqual(RATE_LIMITS.driverLocation.max);
  });
});
