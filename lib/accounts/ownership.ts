/*
  Tenant ownership checks for ids that arrive in a request body (review ACC-14).

  Accounts routes write through the service-role client, so RLS does not stop
  a row in tenant A from referencing tenant B's customer or subcontractor. Every
  referenced id is looked up with a tenant filter first. A malformed id and an
  id from another tenant get the same 404, so ids cannot be probed.

  Server-only.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "../auth/serverTenantAccess";
import { AccountsHttpError } from "./errors";

export async function assertTenantRow(
  admin: SupabaseClient,
  table: "customers" | "subcontractors" | "invoices",
  id: unknown,
  tenantId: string,
  label: string,
): Promise<string> {
  if (!isUuid(id)) {
    throw new AccountsHttpError(404, `${label} not found.`, "not_found");
  }

  const { data, error } = await admin.from(table).select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  if (error) {
    throw new Error(`ownership lookup failed on ${table}: ${error.code ?? ""}`);
  }

  if (!data) {
    throw new AccountsHttpError(404, `${label} not found.`, "not_found");
  }

  return id;
}
