/*
  Client-safe messages for the tachograph routes (review PLAN-22).

  The RPCs in supabase/migrations/20260911131500_tachograph_activity_ledger.sql
  raise a small, known set of exceptions. Those are written for people and are
  mapped to friendly text here. Anything else (a constraint name, a column, a
  provider's internal error, a service-role lookup failure) is logged server
  side by the caller and replaced with a constant, so no database or vendor
  internals reach the browser.
*/

const KNOWN_RPC_MESSAGES: Array<[needle: string, message: string]> = [
  ["authentication required", "You must be signed in."],
  ["tenant access denied", "You do not have access to this tenant."],
  ["tenant administrator required", "Only a tenant administrator can manage driver activity."],
  ["invalid activity kind", "Choose a valid activity type."],
  ["activity end must be after start", "Activity end must be after its start."],
  ["driver not found for tenant", "That driver does not belong to the selected tenant."],
  ["activity overlaps an existing record", "This activity overlaps an existing record for the driver."],
  ["manual activity not found or is not editable", "That activity no longer exists or is not a manual record."],
  ["manual activity not found or is not deletable", "That activity no longer exists or is not a manual record."],
];

export type PublicRpcError = {
  message: string;
  /** True when the message came from the known list; false means a constant fallback. */
  known: boolean;
};

export function publicActivityRpcError(
  rawMessage: string | null | undefined,
  fallback: string,
): PublicRpcError {
  const raw = (rawMessage ?? "").toLowerCase();

  for (const [needle, message] of KNOWN_RPC_MESSAGES) {
    if (raw.includes(needle)) {
      return { message, known: true };
    }
  }

  return { message: fallback, known: false };
}
