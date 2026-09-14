import { describe, expect, it } from "vitest";
import { describeCompanyTimeZone } from "./companyTimeZone";

describe("describeCompanyTimeZone", () => {
  it("uses a valid stored zone for a single company with no note", () => {
    expect(
      describeCompanyTimeZone({ companyIds: ["c1", "c1"], storedTimeZone: "Europe/Paris", loadFailed: false }),
    ).toEqual({ timeZone: "Europe/Paris", note: null });
  });

  it("falls back with a visible note on an invalid stored zone instead of throwing", () => {
    const result = describeCompanyTimeZone({ companyIds: ["c1"], storedTimeZone: "GMT+1x", loadFailed: false });

    expect(result.timeZone).toBe("Europe/London");
    expect(result.note).toContain('"GMT+1x"');
  });

  it("uses the operator default quietly when no zone is stored", () => {
    expect(
      describeCompanyTimeZone({ companyIds: ["c1"], storedTimeZone: null, loadFailed: false }),
    ).toEqual({ timeZone: "Europe/London", note: null });
  });

  it("does not pick one company's zone when several companies are in view", () => {
    const result = describeCompanyTimeZone({ companyIds: ["c1", "c2"], storedTimeZone: "Europe/Paris", loadFailed: false });

    expect(result.timeZone).toBe("Europe/London");
    expect(result.note).toMatch(/more than one company/);
  });

  it("says so when the lookup failed", () => {
    const result = describeCompanyTimeZone({ companyIds: [], storedTimeZone: null, loadFailed: true });

    expect(result.timeZone).toBe("Europe/London");
    expect(result.note).toMatch(/could not be loaded/);
  });
});
