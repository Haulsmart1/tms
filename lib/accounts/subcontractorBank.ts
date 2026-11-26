import { z } from "zod";

export const bankDetailsSchema = z.strictObject({
  accountName: z.string().trim().min(1).max(120),
  sortCode: z.string().trim().regex(/^(?:\d{6}|\d{2}-\d{2}-\d{2})$/).transform((value) => value.replaceAll("-", "")),
  accountNumber: z.string().trim().regex(/^\d{8}$/),
});

export type BankDetails = z.infer<typeof bankDetailsSchema>;
export type BankStatus = {
  latest: { status: "pending" | "approved" | "rejected"; account_last_four: string } | null;
  approved: { account_last_four: string } | null;
};
