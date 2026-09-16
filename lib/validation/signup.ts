import { z } from "zod";

/* Validates the /signup form for POST /api/signup. Modelled on requestAccess.ts
   (same Zod v4 idioms: z.email(), trim first then pipe into the format check).

   strictObject, not object: an unknown key is rejected rather than stripped,
   so a client cannot smuggle a tenant, company or role field into a body that
   is later handed to a service-role call (SQL-13). The honeypot is the one
   optional extra key and is declared here for exactly that reason.

   Bounds are not cosmetic. companyName becomes companies.name and the first
   tenant's name, both shown across the console; contactName becomes
   profiles.full_name. 120 characters is more than any real trading name and
   keeps a pasted paragraph out of both. */

export const SIGNUP_HONEYPOT_FIELD = "companyWebsite";

export const SIGNUP_COMPANY_NAME_MIN = 2;
export const SIGNUP_COMPANY_NAME_MAX = 120;
export const SIGNUP_CONTACT_NAME_MIN = 1;
export const SIGNUP_CONTACT_NAME_MAX = 120;
export const SIGNUP_EMAIL_MAX = 320;

export const SignupValidation = z.strictObject({
  companyName: z
    .string()
    .trim()
    .min(SIGNUP_COMPANY_NAME_MIN, "Enter your company name.")
    .max(SIGNUP_COMPANY_NAME_MAX, `Company name must be ${SIGNUP_COMPANY_NAME_MAX} characters or fewer.`),
  contactName: z
    .string()
    .trim()
    .min(SIGNUP_CONTACT_NAME_MIN, "Enter your name.")
    .max(SIGNUP_CONTACT_NAME_MAX, `Your name must be ${SIGNUP_CONTACT_NAME_MAX} characters or fewer.`),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(SIGNUP_EMAIL_MAX, "Enter a valid email address.")
    .pipe(z.email("Enter a valid email address.")),
  [SIGNUP_HONEYPOT_FIELD]: z.string().max(1000).optional(),
});

export type SignupInput = z.infer<typeof SignupValidation>;

/* True when a bot filled the field real users never see. Checked on the raw
   body BEFORE schema validation, as request-access does, so a bot that also
   sends garbage elsewhere is still answered with the neutral success rather
   than a 400 it could learn from. */
export function isSignupHoneypotTriggered(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = (body as Record<string, unknown>)[SIGNUP_HONEYPOT_FIELD];
  return typeof value === "string" && value.trim() !== "";
}

export type SignupFieldErrors = Partial<Record<"companyName" | "contactName" | "email", string>>;

/* The client-side mirror of the schema, so the form can show the same message
   before a request is made. The server is authoritative: this exists so a
   typo is caught without a round trip, not so the route can trust the client. */
export function describeSignupFieldErrors(input: {
  companyName: string;
  contactName: string;
  email: string;
}): SignupFieldErrors {
  const parsed = SignupValidation.safeParse(input);
  if (parsed.success) return {};
  const errors: SignupFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "companyName" || field === "contactName" || field === "email") && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
