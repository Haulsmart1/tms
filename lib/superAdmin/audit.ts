import type { SupabaseClient } from "@supabase/supabase-js";

/* Durable super-admin audit rows (AUTH-15), in public.super_admin_audit from
   docs/sql/prodfix_10_super_admin_tenant_move.sql. Server-only: pass the
   service-role client.

   Tenant moves write their audit row INSIDE super_admin_move_tenant, in the
   same transaction as the move. This helper covers the lower-stakes edits
   (tenant rename, company edit), where the write has already landed, so a
   missing table is logged rather than failing a change that has happened. */

export type SuperAdminAuditEntry = {
  actorId: string;
  action: string;
  targetType: "tenant" | "company";
  targetId: string;
  changedFields: readonly string[];
  result: "ok" | "partial";
  details?: Record<string, unknown>;
};

/* Field NAMES only, never values, same rule as logSuperAdminEdit: an audit
   table that accumulates postcodes and phone numbers is a PII store nobody is
   auditing for PII. */
export function buildSuperAdminAuditRow(entry: SuperAdminAuditEntry) {
  return {
    actor_id: entry.actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    changed_fields: [...entry.changedFields],
    details: entry.details ?? {},
    result: entry.result,
  };
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export async function recordSuperAdminAudit(
  admin: SupabaseClient,
  entry: SuperAdminAuditEntry,
): Promise<{ recorded: boolean }> {
  try {
    const { error } = await admin.from("super_admin_audit").insert(buildSuperAdminAuditRow(entry));
    if (!error) return { recorded: true };

    if (error.code && MISSING_TABLE_CODES.has(error.code)) {
      console.warn(
        "[superAdminAudit] super_admin_audit is not installed; apply docs/sql/prodfix_10_super_admin_tenant_move.sql",
      );
    } else {
      console.error("[superAdminAudit] could not write audit row", error.code);
    }
  } catch (err) {
    console.error("[superAdminAudit] audit write threw", err);
  }
  return { recorded: false };
}
