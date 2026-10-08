/* The only two transitions the super-admin invoices page offers. Anything
   else (void, credited, sent, ...) belongs to the accounts API's state
   machine in lib/accounts/invoiceStatus.ts and must not be reachable from a
   platform-wide button. Kept as a closed list on purpose: widening it is a
   product decision, not a typo fix. */

import { CREDITABLE_INVOICE_STATUSES } from "../accounts/invoiceStatus";

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

/* Statuses an invoice may be flipped FROM (review S-13). The route adds this
   as an `.in("status", ...)` condition on the update, so the check and the
   write are one statement and a concurrent void cannot slip between them.

   Only an issued, live invoice qualifies: the statuses a credit note may be
   raised against (lib/accounts/invoiceStatus.ts), plus the legacy "pending"
   this page writes. Draft and awaiting_pod have not been issued, and void,
   credited and cancelled are final: the accounts state machine never leaves
   them, so neither does this button. The target itself is excluded so a
   repeat click answers 409 rather than rewriting an audit row. */
const SUPER_ADMIN_FLIPPABLE_STATUSES: readonly string[] = [...CREDITABLE_INVOICE_STATUSES, "pending"];

export function superAdminAllowedFromStatuses(target: SuperAdminInvoiceStatus): string[] {
  return SUPER_ADMIN_FLIPPABLE_STATUSES.filter((status) => status !== target);
}
