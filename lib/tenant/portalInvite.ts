/*
  Pure decisions for /api/settings/portal-invites (review AUTH-5, AUTH-11,
  SET-8).

  An existing account is attached to a portal link only when it has no
  company, or already belongs to the inviting company. Anything else (another
  company's user, a super admin) is left alone, and the admin sees the same
  message as for a fresh invite, so the response never reveals whether an
  address has an account elsewhere on the platform.
*/

export type AccountCompany = string | null | "super";

export function portalLinkDecision(
  accountCompany: AccountCompany,
  invitingCompanyId: string | null,
): "link" | "skip" {
  if (accountCompany === "super") return "skip";
  if (accountCompany === null) return "link";
  return invitingCompanyId !== null && accountCompany === invitingCompanyId ? "link" : "skip";
}

export function portalInviteMessage(kind: "driver" | "subcontractor", email: string): string {
  return kind === "driver"
    ? `Driver portal invitation sent to ${email}.`
    : `Subcontractor portal invitation sent to ${email}.`;
}
