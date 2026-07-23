import { z } from "zod";

/* Validates the landing "Request access" form. Follows the pattern in
   lib/supabase/validation/job.ts: trim strings, coerce numbers, and turn empty
   optional fields into undefined.

   Zod v4 notes: `z.email()` is the current API (the `.email()` string method is
   deprecated), and the params key for a custom message is `error`, not the v3
   `required_error` / `invalid_type_error`. The email is trimmed first and then
   piped into the format check, so " a@b.com " is accepted and stored trimmed. */
const emptyToUndefined = (val: unknown) => (val === "" ? undefined : val);

export const RequestAccessValidation = z.object({
  companyName: z.string().trim().min(1, "Company name is required."),
  contactName: z.string().trim().min(1, "Contact name is required."),
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  phone: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  vehicles: z.coerce
    .number({ error: "Enter how many vehicles you run." })
    .int("Enter a whole number.")
    .positive("Enter at least one vehicle."),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

export type RequestAccessInput = z.infer<typeof RequestAccessValidation>;
