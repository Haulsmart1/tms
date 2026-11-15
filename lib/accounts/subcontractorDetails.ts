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

export const SUBCONTRACTOR_DETAIL_COLUMNS = subcontractorDetailFields.map(([key]) => key).join(",");
export type SubcontractorDetails = Record<(typeof subcontractorDetailFields)[number][0], string | null>;
const schema = z.object(Object.fromEntries(subcontractorDetailFields.map(([key, , maximum, type]) => [
  key,
  z.string().trim().max(maximum)
    .refine((value) => type !== "email" || !value || z.email().safeParse(value).success)
    .transform((value) => value || null),
]))).strict();

export function parseSubcontractorDetails(input: unknown) {
  return schema.safeParse(input);
}
