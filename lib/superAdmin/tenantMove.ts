/* Maps a super_admin_move_tenant RPC failure to what the route returns
   (AUTH-3). Pure so each branch is tested; the route is under app/, which
   vitest does not reach. */

export type MoveTenantFailure = {
  status: 400 | 403 | 404 | 409 | 500 | 503;
  error: string;
  field?: "company_id";
};

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

export const MOVE_TENANT_MIGRATION_MISSING =
  "Moving a tenant needs docs/sql/prodfix_10_super_admin_tenant_move.sql applied first, so that its users move with it. Nothing was changed.";

export function interpretMoveTenantError(error: RpcError): MoveTenantFailure {
  const code = error?.code ?? "";
  const message = error?.message ?? "";

  if (MISSING_FUNCTION_CODES.has(code)) {
    return { status: 503, error: MOVE_TENANT_MIGRATION_MISSING };
  }

  const admins = /tenant_has_company_admins:(\d+)/.exec(message);
  if (admins) {
    const count = Number(admins[1]);
    const who = count === 1 ? "1 company admin has" : `${count} company admins have`;
    return {
      status: 409,
      error: `${who} this tenant as their home tenant. Moving it would make them admins of every tenant in the new company, so reassign or demote them first. Nothing was changed.`,
    };
  }

  if (message.includes("no_such_tenant")) return { status: 404, error: "No such tenant." };
  if (message.includes("no_such_company")) {
    return { status: 400, error: "No such company.", field: "company_id" };
  }
  if (message.includes("actor_not_super_admin")) {
    return { status: 403, error: "Super admin access is required." };
  }

  return { status: 500, error: "Unable to update this tenant." };
}

/* The RPC's jsonb result, read defensively. */
export function readProfilesMoved(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>).profiles_moved;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
