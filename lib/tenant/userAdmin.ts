/*
  Pure decisions for /settings/users and its API routes.

  Roles and tenancy come from profiles (role_id -> roles.name, company_id,
  tenant_id), exactly as RLS and get_tenant_context() read them. memberships is
  legacy: the SQL functions in docs/sql/prodfix_20_user_management.sql still
  keep it in step, but nothing here reads it for authorization.

  The database functions enforce the invariants that need a lock (last admin,
  company membership, super admin protection). These helpers decide what can
  be refused before calling them, and turn their outcomes and error tokens
  into responses that never leak raw database text.
*/

import type { RoleTier } from "../auth/tenantAccess";
import { SUPER_ADMIN_ROLE } from "../roles";

export const INVITABLE_ROLES = ["admin", "staff", "driver"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function parseInvitableRole(raw: unknown): InvitableRole | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (INVITABLE_ROLES as readonly string[]).includes(value) ? (value as InvitableRole) : null;
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type ApiOutcome = { status: number; body: Record<string, unknown> };

export type ProvisionOutcome = "created" | "repaired" | "already_member" | "other_company";

export function parseProvisionOutcome(raw: unknown): ProvisionOutcome | null {
  return raw === "created" || raw === "repaired" || raw === "already_member" || raw === "other_company"
    ? raw
    : null;
}

/**
  AUTH-11 / SET-8: 'created' and 'other_company' MUST produce byte-identical
  responses, so an admin cannot learn whether an address has an account in
  another company. Same-company outcomes may differ: that admin can already
  see those users in their own list.
*/
export function inviteResponse(outcome: ProvisionOutcome, email: string): ApiOutcome {
  switch (outcome) {
    case "created":
    case "other_company":
      return { status: 200, body: { ok: true, message: `Invitation sent to ${email}.` } };
    case "repaired":
      return {
        status: 200,
        body: { ok: true, message: `${email} is now linked to this company and can sign in.` },
      };
    case "already_member":
      return {
        status: 409,
        body: { error: `${email} already belongs to this company. Edit their role from the list instead.` },
      };
  }
}

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

export const MIGRATION_MISSING_MESSAGE =
  "User management is unavailable until the database update prodfix_20 is applied. Nothing was changed.";

/** Maps an RPC error from the prodfix_20 functions to a safe response. */
export function userAdminErrorResponse(error: { code?: string | null; message?: string | null } | null): ApiOutcome {
  if (error?.code && MISSING_FUNCTION_CODES.has(error.code)) {
    return { status: 503, body: { error: MIGRATION_MISSING_MESSAGE } };
  }

  const token = String(error?.message ?? "").trim();
  switch (token) {
    case "last_admin":
      return { status: 409, body: { error: "The company must keep at least one administrator." } };
    case "not_in_company":
      return { status: 404, body: { error: "That user does not belong to this company." } };
    case "super_admin_protected":
      return { status: 403, body: { error: "Only a platform super admin can change a super admin." } };
    case "invalid_role":
      return { status: 400, body: { error: "Invalid role." } };
    case "role_missing":
    case "role_ambiguous":
      return {
        status: 500,
        body: { error: "That role is not configured in the database. Ask platform support to add it." },
      };
    case "tenant_not_found":
    case "tenant_without_company":
      return { status: 409, body: { error: "The selected tenant is not linked to a company." } };
    default:
      return { status: 500, body: { error: "Unable to update users right now. Nothing may have been saved; try again." } };
  }
}

export type TargetUser = { userId: string; roleName: string | null };

/** Refusals that do not need the database, for a role edit. */
export function checkRoleEdit(input: {
  callerId: string;
  callerTier: RoleTier;
  target: TargetUser;
  newRole: InvitableRole;
}): ApiOutcome | null {
  const { callerId, callerTier, target, newRole } = input;

  if (target.roleName === SUPER_ADMIN_ROLE && callerTier !== "super_admin") {
    return { status: 403, body: { error: "Only a platform super admin can change a super admin." } };
  }
  if (target.userId === callerId && (target.roleName ?? "") !== newRole) {
    return { status: 403, body: { error: "You cannot change your own role. Ask another administrator." } };
  }
  return null;
}

/** Refusals that do not need the database, for removing a user. */
export function checkRemoval(input: {
  callerId: string;
  callerTier: RoleTier;
  target: TargetUser;
}): ApiOutcome | null {
  const { callerId, callerTier, target } = input;

  if (target.userId === callerId) {
    return { status: 403, body: { error: "You cannot remove yourself." } };
  }
  if (target.roleName === SUPER_ADMIN_ROLE && callerTier !== "super_admin") {
    return { status: 403, body: { error: "Only a platform super admin can change a super admin." } };
  }
  return null;
}

/** True when the caller may open the edit or remove controls for a listed user. */
export function canManageListedUser(callerRole: string, targetRole: string | null): boolean {
  if (callerRole !== "admin" && callerRole !== SUPER_ADMIN_ROLE) return false;
  if (targetRole === SUPER_ADMIN_ROLE) return callerRole === SUPER_ADMIN_ROLE;
  return true;
}

export type ProfileListRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  tenant_id: string | null;
  company_id: string | null;
  role_id: string | null;
  roles?: { name: string } | { name: string }[] | null;
};

export type ListedUser = {
  membership_id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  membership_created_at: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  company_id: string | null;
  role_id: string | null;
};

function roleNameOf(roles: ProfileListRow["roles"]): string | null {
  if (!roles) return null;
  if (Array.isArray(roles)) return typeof roles[0]?.name === "string" ? roles[0].name : null;
  return typeof roles.name === "string" ? roles.name : null;
}

/** Profiles homed in a tenant, shaped for the users page. A null role reads as staff, as in RLS. */
export function buildListedUsers(
  tenantId: string,
  profiles: readonly ProfileListRow[],
  emailById: ReadonlyMap<string, string | null>,
): ListedUser[] {
  return profiles
    .filter((profile) => profile.tenant_id === tenantId)
    .map((profile) => ({
      membership_id: profile.id,
      user_id: profile.id,
      tenant_id: tenantId,
      role: roleNameOf(profile.roles) ?? "staff",
      membership_created_at: null,
      email: emailById.get(profile.id) ?? null,
      full_name: profile.full_name,
      phone: profile.phone,
      company_id: profile.company_id,
      role_id: profile.role_id,
    }))
    .sort((a, b) => (a.email ?? a.full_name ?? "").localeCompare(b.email ?? b.full_name ?? ""));
}
