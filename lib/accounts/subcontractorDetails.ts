import { z } from "zod";

export const subcontractorDetailFields = [
  ["legal_name", "Legal name", 200, "text"],
  ["trading_name", "Trading name", 200, "text"],
  ["company_number", "Company number", 40, "text"],
  ["vat_number", "VAT number", 40, "text"],
  ["contact_name", "Contact name", 160, "text"],
  ["phone", "Telephone", 50, "tel"],
  ["email", "Contact email", 254, "email"],
  ["accounts_email", "Accounts email", 254, "email"],
  ["address", "Business address", 1000, "text"],
] as const;

const insuranceTypes = [
  ["goods_in_transit", "Goods in transit"],
  ["public_liability", "Public liability"],
  ["employers_liability", "Employers’ liability"],
  ["motor_insurance", "Motor insurance"],
] as const;

export const subcontractorInsuranceFields = insuranceTypes.map(([prefix, label]) => [
  [`${prefix}_insurer`, `${label} insurer`, 160, "text"],
  [`${prefix}_policy_number`, `${label} policy number`, 100, "text"],
  [`${prefix}_expiry`, `${label} expiry`, 10, "date"],
] as const);

export const subcontractorComplianceFields = [
  ["operator_licence_number", "Operator licence number", 80, "text"],
  ["waste_carrier_licence", "Waste carrier licence", 80, "text"],
  ["waste_carrier_expiry", "Waste carrier licence expiry", 10, "date"],
] as const;

const detailFields = [
  ...subcontractorDetailFields, ...subcontractorInsuranceFields.flat(), ...subcontractorComplianceFields,
];

export const SUBCONTRACTOR_DETAIL_COLUMNS = [...detailFields.map(([key]) => key), "adr_capable"].join(",");
export type SubcontractorDetails = Record<(typeof detailFields)[number][0], string | null> & { adr_capable: boolean };
const schema = z.object(Object.fromEntries(detailFields.map(([key, , maximum, type]) => [
  key,
  z.string().trim().max(maximum)
    .refine((value) => type !== "email" || !value || z.email().safeParse(value).success)
    .refine((value) => type !== "date" || !value || (value >= "0001-01-01" && z.iso.date().safeParse(value).success))
    .transform((value) => value || null),
])))
  .extend({ adr_capable: z.boolean() })
  .partial().strict().refine((value) => Object.keys(value).length > 0);

export function parseSubcontractorDetails(input: unknown) {
  return schema.safeParse(input);
}
