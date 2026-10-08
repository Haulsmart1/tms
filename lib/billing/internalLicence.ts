import type { SupabaseClient } from "@supabase/supabase-js";

export type InternalLicence = {
  id: string;
  billing_mode: "internal";
  internal_authorised_by: string;
  internal_authorised_at: string;
  internal_reason: string;
};

// History is authoritative: an office user cannot turn an internal vehicle
// into a paid one by adding a second compliance document or reactivating it.
export async function loadInternalLicence(
  admin: SupabaseClient,
  vehicleId: string,
): Promise<InternalLicence | null> {
  const { data, error } = await admin.from("vehicle_licences")
    .select("id, billing_mode, internal_authorised_by, internal_authorised_at, internal_reason")
    .eq("vehicle_id", vehicleId).eq("billing_mode", "internal")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as InternalLicence | null;
}

// This writer has no payment/period/subscription dependency. Only a prior
// server-authorised internal licence can reach it; granting is a separate RPC.
export async function writeInternalLicence(
  admin: SupabaseClient,
  authorisation: InternalLicence,
  body: {
    action: "create"; tenantId: string; vehicleId: string;
    licenceType: string; issueDate: string | null; expiryDate: string | null;
    active: boolean; notes: string | null;
  } | { action: "setActive"; licenceId: string; active: boolean },
): Promise<void> {
  const result = body.action === "create"
    ? await admin.from("vehicle_licences").insert({
        tenant_id: body.tenantId, vehicle_id: body.vehicleId,
        licence_type: body.licenceType, issue_date: body.issueDate,
        expiry_date: body.expiryDate, active: body.active, notes: body.notes,
        billing_mode: "internal",
        internal_authorised_by: authorisation.internal_authorised_by,
        internal_authorised_at: authorisation.internal_authorised_at,
        internal_reason: authorisation.internal_reason,
      })
    : await admin.from("vehicle_licences").update({ active: body.active })
        .eq("id", body.licenceId).eq("billing_mode", "internal");
  if (result.error) throw new Error(result.error.message);
}
