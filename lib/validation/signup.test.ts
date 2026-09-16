import { describe, expect, it } from "vitest";
import {
  SIGNUP_COMPANY_NAME_MAX,
  SIGNUP_CONTACT_NAME_MAX,
  SIGNUP_EMAIL_MAX,
  SIGNUP_HONEYPOT_FIELD,
  SignupValidation,
  describeSignupFieldErrors,
  isSignupHoneypotTriggered,
} from "./signup";

const valid = {
  companyName: "Northgate Haulage Ltd",
  contactName: "Sam Founder",
  email: "sam@northgate.example",
};

describe("SignupValidation", () => {
  it("accepts valid input and normalises it", () => {
    const parsed = SignupValidation.safeParse({
      companyName: "  Northgate Haulage Ltd  ",
      contactName: " Sam Founder ",
      email: "  Sam.Founder@Northgate.EXAMPLE ",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({
      companyName: "Northgate Haulage Ltd",
      contactName: "Sam Founder",
      email: "sam.founder@northgate.example",
    });
  });

  it("accepts the honeypot key when present and empty", () => {
    const parsed = SignupValidation.safeParse({ ...valid, [SIGNUP_HONEYPOT_FIELD]: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown key rather than stripping it", () => {
    const parsed = SignupValidation.safeParse({ ...valid, tenant_id: "x" });
    expect(parsed.success).toBe(false);
    const another = SignupValidation.safeParse({ ...valid, role: "super_admin" });
    expect(another.success).toBe(false);
  });

  it.each([
    ["one character", "A"],
    ["whitespace only", "   "],
    ["too long", "A".repeat(SIGNUP_COMPANY_NAME_MAX + 1)],
  ])("rejects a company name that is %s", (_label, companyName) => {
    expect(SignupValidation.safeParse({ ...valid, companyName }).success).toBe(false);
  });

  it("accepts a company name at both bounds", () => {
    expect(SignupValidation.safeParse({ ...valid, companyName: "AB" }).success).toBe(true);
    expect(
      SignupValidation.safeParse({ ...valid, companyName: "A".repeat(SIGNUP_COMPANY_NAME_MAX) }).success,
    ).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", " "],
    ["too long", "B".repeat(SIGNUP_CONTACT_NAME_MAX + 1)],
  ])("rejects a contact name that is %s", (_label, contactName) => {
    expect(SignupValidation.safeParse({ ...valid, contactName }).success).toBe(false);
  });

  it("accepts a contact name at both bounds", () => {
    expect(SignupValidation.safeParse({ ...valid, contactName: "B" }).success).toBe(true);
    expect(
      SignupValidation.safeParse({ ...valid, contactName: "B".repeat(SIGNUP_CONTACT_NAME_MAX) }).success,
    ).toBe(true);
  });

  it.each([
    ["missing an @", "not-an-email"],
    ["with spaces", "sam @northgate.example"],
    ["empty", ""],
    ["over the length cap", `${"a".repeat(SIGNUP_EMAIL_MAX)}@x.io`],
  ])("rejects an email %s", (_label, email) => {
    expect(SignupValidation.safeParse({ ...valid, email }).success).toBe(false);
  });

  it("keeps plus-addressing and lowercases the whole address", () => {
    const parsed = SignupValidation.safeParse({ ...valid, email: "Sam+Trial@Northgate.example" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe("sam+trial@northgate.example");
  });

  it("rejects a missing field and a non-object body", () => {
    expect(SignupValidation.safeParse({ companyName: "X Ltd", email: valid.email }).success).toBe(false);
    expect(SignupValidation.safeParse(null).success).toBe(false);
    expect(SignupValidation.safeParse("string").success).toBe(false);
  });
});

describe("isSignupHoneypotTriggered", () => {
  it("is true only for a non-empty honeypot string", () => {
    expect(isSignupHoneypotTriggered({ ...valid, [SIGNUP_HONEYPOT_FIELD]: "http://bot.example" })).toBe(true);
    expect(isSignupHoneypotTriggered({ ...valid, [SIGNUP_HONEYPOT_FIELD]: "" })).toBe(false);
    expect(isSignupHoneypotTriggered({ ...valid, [SIGNUP_HONEYPOT_FIELD]: "   " })).toBe(false);
    expect(isSignupHoneypotTriggered(valid)).toBe(false);
    expect(isSignupHoneypotTriggered({ ...valid, [SIGNUP_HONEYPOT_FIELD]: 1 })).toBe(false);
    expect(isSignupHoneypotTriggered(null)).toBe(false);
    expect(isSignupHoneypotTriggered([SIGNUP_HONEYPOT_FIELD])).toBe(false);
  });
});

describe("describeSignupFieldErrors", () => {
  it("returns nothing for valid input", () => {
    expect(describeSignupFieldErrors(valid)).toEqual({});
  });

  it("returns one message per failing field, keyed by field", () => {
    const errors = describeSignupFieldErrors({ companyName: "A", contactName: "", email: "nope" });
    expect(Object.keys(errors).sort()).toEqual(["companyName", "contactName", "email"]);
    expect(errors.companyName).toBe("Enter your company name.");
    expect(errors.contactName).toBe("Enter your name.");
    expect(errors.email).toBe("Enter a valid email address.");
  });
});
