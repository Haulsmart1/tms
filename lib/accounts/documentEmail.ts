/*
  Server-side gate shared by the invoice and quotation email routes
  (review ACC-5 / audit M1, ACC-18 / audit M6).

  - the recipient must be stored on the customer or its contacts, or be the
    caller's own address (lib/accounts/recipients.ts);
  - sends are rate limited per user and per tenant (docs/sql/prodfix_01).

  Server-only: takes the service-role client after the route has authorized
  the caller for `tenantId`.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit, RATE_LIMITS } from "../rateLimit";
import { AccountsHttpError } from "./errors";
import { resolveDocumentRecipient } from "./recipients";

async function customerContactEmails(admin: SupabaseClient, tenantId: string, customerId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("customer_contacts")
    .select("email")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);

  if (error) {
    // Contacts only widen the allowed set, so failing to read them narrows it.
    console.warn("[documentEmail] customer_contacts lookup failed", error.code);
    return [];
  }

  return (data ?? [])
    .map((row) => (row as { email?: unknown }).email)
    .filter((value): value is string => typeof value === "string");
}

export async function authorizeDocumentRecipient(input: {
  admin: SupabaseClient;
  tenantId: string;
  customerId: string;
  requested: unknown;
  defaults: readonly unknown[];
  customerEmails: readonly unknown[];
  callerEmail: unknown;
}): Promise<string> {
  const contacts = await customerContactEmails(input.admin, input.tenantId, input.customerId);

  const result = resolveDocumentRecipient({
    requested: input.requested,
    defaults: input.defaults,
    allowed: [...input.customerEmails, ...contacts],
    callerEmail: input.callerEmail,
  });

  if (!result.ok) {
    throw new AccountsHttpError(result.status, result.message, result.code);
  }

  return result.recipient;
}

export async function enforceDocumentEmailLimits(admin: SupabaseClient, userId: string, tenantId: string): Promise<void> {
  const [perUser, perTenant] = await Promise.all([
    checkRateLimit(admin, RATE_LIMITS.documentEmailPerUser, userId),
    checkRateLimit(admin, RATE_LIMITS.documentEmailPerTenant, tenantId),
  ]);

  if (!perUser.allowed || !perTenant.allowed) {
    throw new AccountsHttpError(
      429,
      "Too many documents have been emailed recently. Please wait before sending more.",
      "rate_limited"
    );
  }
}
