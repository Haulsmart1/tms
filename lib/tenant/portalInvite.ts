/*
  Pure decisions for /api/settings/portal-invites (review AUTH-5, AUTH-11,
  SET-8).

  An existing account is attached to a portal link only when it has no
  company, or already belongs to the inviting company. Anything else (another
  company's user, a super admin) is left alone, and the admin sees the same
  message as for a fresh invite, so the response never reveals whether an
  address has an account elsewhere on the platform.

  "No company" is not the same as "nobody's": a portal-only driver or
  subcontractor has no profile, so their company is known only from the
  portal links they already hold. An account with an active link in another
  company is that company's, and is never attached here (2026-09-15 follow-up;
  before it, company B could silently take over company A's driver).
*/

export type AccountCompany = string | null | "super";

export function portalLinkDecision(
  accountCompany: AccountCompany,
  invitingCompanyId: string | null,
  /** Company of each tenant the account already holds an active portal link in; null when that tenant has none. */
  portalLinkCompanies: readonly (string | null)[],
): "link" | "skip" {
  if (accountCompany === "super") return "skip";
  if (accountCompany !== null) {
    return invitingCompanyId !== null && accountCompany === invitingCompanyId ? "link" : "skip";
  }
  if (portalLinkCompanies.length === 0) return "link";
  return invitingCompanyId !== null && portalLinkCompanies.every((company) => company === invitingCompanyId)
    ? "link"
    : "skip";
}

export function portalInviteMessage(kind: "driver" | "subcontractor", email: string): string {
  return kind === "driver"
    ? `Driver portal invitation sent to ${email}.`
    : `Subcontractor portal invitation sent to ${email}.`;
}
