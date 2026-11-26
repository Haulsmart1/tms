import { describe, expect, it } from "vitest";
import { parseSubcontractorDetails } from "./subcontractorDetails";
import { bankDetailsSchema } from "./subcontractorBank";

describe("subcontractor self-service fields", () => {
  it("updates only the supplied company, insurance and compliance fields", () => {
    expect(parseSubcontractorDetails({
      legal_name: " Example Haulage ",
      motor_insurance_expiry: "2028-02-29",
      waste_carrier_expiry: "",
      adr_capable: false,
    })).toMatchObject({
      success: true,
      data: {
        legal_name: "Example Haulage",
        motor_insurance_expiry: "2028-02-29",
        waste_carrier_expiry: null,
        adr_capable: false,
      },
    });
    expect(parseSubcontractorDetails({ contact_name: "Alex" })).toMatchObject({
      success: true, data: { contact_name: "Alex" },
    });
  });

  it.each([
    {}, { motor_insurance_expiry: "2027-02-29" }, { email: "invalid" },
    { adr_capable: "false" }, { tenant_id: "other" }, { subcontractor_id: "other" },
    { active: true }, { default_rate: 100 }, { status: "approved" },
  ])("rejects invalid or privileged fields %j", (input) => {
    expect(parseSubcontractorDetails(input).success).toBe(false);
  });
});

describe("subcontractor bank details", () => {
  const details = { accountName: "Example Haulage", sortCode: "00-01-23", accountNumber: "00123456" };

  it("normalises sort codes and preserves leading zeroes", () => {
    expect(bankDetailsSchema.parse(details)).toEqual({ ...details, sortCode: "000123" });
  });

  it.each([{ accountNumber: "1234567" }, { sortCode: "12--34-56" }, { status: "approved" }, { accountName: " " }])(
    "rejects invalid or privileged bank fields %j",
    (fields) => expect(bankDetailsSchema.safeParse({ ...details, ...fields }).success).toBe(false),
  );
});
