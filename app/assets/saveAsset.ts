/* Browser insert/update for /assets, moved out of the page with its behaviour
   unchanged, plus a zero-row check on update (an RLS-filtered UPDATE is not an
   error in Postgres, it just matches nothing). Throws Error(message) for the
   dialog to show. */

import type { createClient } from "../../lib/supabase/browser";
import {
  ASSET_DUPLICATE_NUMBER_MESSAGE,
  ASSET_NOT_UPDATED_MESSAGE,
  assetWriteMessage,
} from "../../lib/assets/errors";
import { buildAssetPayload, validateAssetForm } from "../../lib/assets/payload";
import type { Asset, AssetFormValues, AssetType } from "../../lib/assets/types";

type BrowserClient = ReturnType<typeof createClient>;

export async function saveAsset(input: {
  supabase: BrowserClient;
  values: AssetFormValues;
  /** The asset being edited, or null to add a new one. */
  editing: Asset | null;
  writeTenantId: string | null;
  assetTypes: readonly AssetType[];
}): Promise<"added" | "updated"> {
  const { supabase, values, editing, writeTenantId, assetTypes } = input;

  const check = validateAssetForm(values, assetTypes);
  if (!check.ok) throw new Error(check.error);

  /* An admin viewing "All tenants" has no write target, so a new asset would
     have nowhere to land. Editing an existing row is still fine: it is
     matched by id and scoped by the row's own tenant. */
  if (!editing && !writeTenantId) {
    throw new Error("Select a single tenant before adding an asset.");
  }

  const assetNumber = values.assetNumber.trim();

  /* The uniqueness rule is per tenant, so the check must be scoped to the
     tenant the row will live in, not to whatever is on screen: for an edit
     that is the row's existing tenant, for an insert the write target.
     Archived assets still hold their number. */
  const duplicateTenantId = editing ? editing.tenant_id : writeTenantId;

  let duplicateQuery = supabase.from("assets").select("id").eq("asset_number", assetNumber);
  if (duplicateTenantId) duplicateQuery = duplicateQuery.eq("tenant_id", duplicateTenantId);
  if (editing) duplicateQuery = duplicateQuery.neq("id", editing.id);

  const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1);
  if (duplicateError) throw new Error(assetWriteMessage(duplicateError));
  if ((duplicate ?? []).length > 0) {
    throw new Error(ASSET_DUPLICATE_NUMBER_MESSAGE);
  }

  const payload = buildAssetPayload(values, check.type);

  if (editing) {
    /* No tenant_id/company_id in the update: an edit must never repoint a
       row at another tenant, and RLS already decides which rows this id is
       allowed to match. */
    const { data, error } = await supabase
      .from("assets")
      .update(payload)
      .eq("id", editing.id)
      .select("id");
    if (error) throw new Error(assetWriteMessage(error));
    if ((data ?? []).length === 0) throw new Error(ASSET_NOT_UPDATED_MESSAGE);
    return "updated";
  }

  /* company_id comes from the TARGET TENANT, not from the tenant context.
     get_tenant_context() hands a super_admin every tenant in the platform
     while reporting their OWN company_id (rls_07), so stamping the context
     value would file another company's asset under the operator's company.
     Reading it off the tenants row is correct for all three roles, and RLS
     on `tenants` is what keeps this lookup honest. */
  const { data: tenantRow, error: tenantRowError } = await supabase
    .from("tenants")
    .select("company_id")
    .eq("id", writeTenantId)
    .maybeSingle();
  if (tenantRowError) throw new Error(assetWriteMessage(tenantRowError));
  if (!tenantRow?.company_id) {
    throw new Error(
      "That tenant is not linked to a company. Ask an administrator to complete the company assignment.",
    );
  }

  const { error } = await supabase.from("assets").insert({
    ...payload,
    tenant_id: writeTenantId,
    company_id: String(tenantRow.company_id),
  });
  if (error) throw new Error(assetWriteMessage(error));
  return "added";
}
