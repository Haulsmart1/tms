import { describe, it, expect } from "vitest";
import { RequestAccessValidation } from "./requestAccess";

describe("RequestAccessValidation", () => {
  const valid = {
    companyName: "ADR Carriers",
    contactName: "Stuart",
    email: "stuart@adrcarriers.net",
    phone: "",
    vehicles: "12",
    notes: "",
  };

  it("accepts a valid payload and coerces vehicles to a number", () => {
    const parsed = RequestAccessValidation.parse(valid);
    expect(parsed.vehicles).toBe(12);
    expect(parsed.companyName).toBe("ADR Carriers");
  });

  it("trims surrounding whitespace", () => {
    const parsed = RequestAccessValidation.parse({
      ...valid,
      companyName: "  ADR Carriers  ",
      email: "  stuart@adrcarriers.net  ",
    });
    expect(parsed.companyName).toBe("ADR Carriers");
    expect(parsed.email).toBe("stuart@adrcarriers.net");
  });

  it("rejects a missing company name", () => {
    const result = RequestAccessValidation.safeParse({ ...valid, companyName: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects a bad email", () => {
    const result = RequestAccessValidation.safeParse({ ...valid, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects zero, negative, or fractional vehicles", () => {
    expect(RequestAccessValidation.safeParse({ ...valid, vehicles: "0" }).success).toBe(false);
    expect(RequestAccessValidation.safeParse({ ...valid, vehicles: "-3" }).success).toBe(false);
    expect(RequestAccessValidation.safeParse({ ...valid, vehicles: "2.5" }).success).toBe(false);
  });

  it("allows optional phone and notes to be empty", () => {
    const parsed = RequestAccessValidation.parse({ ...valid, phone: "", notes: "" });
    expect(parsed.phone).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it("exposes field-keyed errors for the client", () => {
    const result = RequestAccessValidation.safeParse({
      ...valid,
      companyName: "",
      email: "nope",
    });
    if (result.success) throw new Error("expected failure");
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.companyName?.[0]).toBeTruthy();
    expect(fieldErrors.email?.[0]).toBeTruthy();
  });
});
