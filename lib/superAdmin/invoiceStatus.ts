/* The only two transitions the super-admin invoices page offers. Anything
   else (void, credited, sent, ...) belongs to the accounts API's state
   machine in lib/accounts/invoiceStatus.ts and must not be reachable from a
   platform-wide button. Kept as a closed list on purpose: widening it is a
   product decision, not a typo fix. */

export const SUPER_ADMIN_INVOICE_STATUSES = ["paid", "pending"] as const;
export type SuperAdminInvoiceStatus = (typeof SUPER_ADMIN_INVOICE_STATUSES)[number];

export type ParsedInvoiceStatus =
  | { ok: true; status: SuperAdminInvoiceStatus }
  | { ok: false; error: string };

export function parseSuperAdminInvoiceStatus(body: unknown): ParsedInvoiceStatus {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected a JSON body with a status." };
  }
  const raw = (body as { status?: unknown }).status;
  if (typeof raw !== "string" || !(SUPER_ADMIN_INVOICE_STATUSES as readonly string[]).includes(raw)) {
    return { ok: false, error: "Status must be one of: paid, pending." };
  }
  return { ok: true, status: raw as SuperAdminInvoiceStatus };
}
