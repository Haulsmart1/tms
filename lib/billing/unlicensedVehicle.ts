// Recognises the database refusal raised when an unlicensed vehicle is
// assigned to work (docs/sql/prodfix_30_vehicle_licence_gate.sql, BILL1-1).
//
// Pure and client-safe on purpose: the jobs, planning and drivers pages write
// through the browser client and need to turn the raw Postgres error into the
// sentence the database already wrote for them. No server imports here.
//
// THE CONTRACT with the SQL trigger, and both sides must change together:
//   errcode  LIC01                (custom SQLSTATE, surfaced by PostgREST as `code`)
//   hint     vehicle_unlicensed
//   message  "Vehicle <registration> has no active licence. Activate it on the
//            Licences page before assigning it."

//
// The same trigger refuses a vehicle whose company has CANCELLED its platform
// subscription (cancelling set company_billing.status but left every licence
// active, so a cancelled company could keep running its fleet for GBP 0):
//   errcode  LIC02
//   hint     company_billing_cancelled
//   message  "Vehicle <registration> cannot be assigned to new work because
//            this company's subscription is cancelled."
// Both refusals go through the helpers below, so every page that already
// handles LIC01 shows the right sentence for LIC02 without changes.

export const UNLICENSED_VEHICLE_ERRCODE = "LIC01";
export const UNLICENSED_VEHICLE_HINT = "vehicle_unlicensed";
export const CANCELLED_COMPANY_ERRCODE = "LIC02";
export const CANCELLED_COMPANY_HINT = "company_billing_cancelled";

const FALLBACK_MESSAGE =
  "This vehicle has no active licence. Activate it on the Licences page before assigning it.";
const CANCELLED_FALLBACK_MESSAGE =
  "This vehicle cannot be assigned to new work because this company's subscription is cancelled.";

// Matches the sentence the trigger raises, so an RPC caller that rethrows only
// `error.message` (for example `new Error(\`save failed: ${error.message}\`)`)
// is still recognised. Anchored on the full second sentence rather than the
// words "no active licence" alone, which could appear in unrelated copy.
const SENTENCE =
  /Vehicle .{1,80}? has no active licence\. Activate it on the Licences page before assigning it\./;
const CANCELLED_SENTENCE =
  /Vehicle .{1,80}? cannot be assigned to new work because this company's subscription is cancelled\./;

type ErrorLike = {
  code?: unknown;
  hint?: unknown;
  message?: unknown;
};

function asErrorLike(error: unknown): ErrorLike | null {
  if (error === null || typeof error !== "object") return null;
  return error as ErrorLike;
}

function isCancelledCompanyError(e: ErrorLike): boolean {
  if (e.code === CANCELLED_COMPANY_ERRCODE) return true;
  if (e.hint === CANCELLED_COMPANY_HINT) return true;
  return typeof e.message === "string" && CANCELLED_SENTENCE.test(e.message);
}

export function isUnlicensedVehicleError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (!e) return false;
  if (isCancelledCompanyError(e)) return true;
  if (e.code === UNLICENSED_VEHICLE_ERRCODE) return true;
  if (e.hint === UNLICENSED_VEHICLE_HINT) return true;
  return typeof e.message === "string" && SENTENCE.test(e.message);
}

/**
 * The customer-facing sentence for an unlicensed-vehicle refusal. Returns the
 * database's own sentence when it can be found (it names the registration),
 * otherwise generic copy. Callers should check isUnlicensedVehicleError first;
 * this never returns raw Postgres text for an unrelated error.
 */
export function unlicensedVehicleMessage(error: unknown): string {
  const e = asErrorLike(error);
  if (e && isCancelledCompanyError(e)) {
    const match = typeof e.message === "string" ? e.message.match(CANCELLED_SENTENCE) : null;
    return match ? match[0] : CANCELLED_FALLBACK_MESSAGE;
  }
  if (e && isUnlicensedVehicleError(error) && typeof e.message === "string") {
    const match = e.message.match(SENTENCE);
    if (match) return match[0];
  }
  return FALLBACK_MESSAGE;
}
