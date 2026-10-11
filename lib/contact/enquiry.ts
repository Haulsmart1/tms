import { z } from "zod";
import { SITE_ORIGIN } from "../seo/site";
import { PUBLIC_CONTACT } from "./details";

export const ENQUIRY_TYPES = ["Product enquiry", "Request access", "Existing customer support", "Other"] as const;

export const EnquirySchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100, "Use 100 characters or fewer."),
  company: z.string().trim().min(2, "Enter your company or business name.").max(150, "Use 150 characters or fewer."),
  email: z.string().trim().max(254, "Use 254 characters or fewer.").email("Enter a valid email address."),
  phone: z.string().trim().max(40, "Use 40 characters or fewer.").refine(
    (value) => value === "" || (/^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7),
    "Enter a telephone number, or leave this blank.",
  ),
  enquiry: z.enum(ENQUIRY_TYPES),
  vehicles: z.string().trim().refine(
    (value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000),
    "Enter a whole number from 1 to 10,000, or leave this blank.",
  ),
  message: z.string().trim().min(10, "Tell us a little more about your enquiry (at least 10 characters).").max(5000, "Use 5,000 characters or fewer."),
});

export type Enquiry = z.infer<typeof EnquirySchema>;
export type EnquiryErrors = Partial<Record<keyof Enquiry, string[]>>;

export const FORM_OPTIONS = {
  _subject: "TMS Wizard website enquiry",
  _template: "table",
  _url: `${SITE_ORIGIN}${PUBLIC_CONTACT.path}`,
  _next: `${SITE_ORIGIN}${PUBLIC_CONTACT.thankYouPath}`,
} as const;

export function formSubmitPayload(enquiry: Enquiry, honey = "") {
  // Explicit keys keep client-supplied _cc, recipients or arbitrary provider
  // options out of the enhanced form. No autoresponder or secret is required.
  return { ...enquiry, ...FORM_OPTIONS, _honey: honey };
}

export function formSubmitResult(value: unknown): "submitted" | "activation-required" | "failed" {
  if (!value || typeof value !== "object") return "failed";
  const data = value as { success?: unknown; message?: unknown };
  // A first-use activation response is not proof that the enquiry was emailed.
  if (typeof data.message === "string" && /activat|confirm.*email/i.test(data.message)) return "activation-required";
  return data.success === true || data.success === "true" ? "submitted" : "failed";
}
