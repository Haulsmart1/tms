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

export const UNLICENSED_VEHICLE_ERRCODE = "LIC01";
export const UNLICENSED_VEHICLE_HINT = "vehicle_unlicensed";

const FALLBACK_MESSAGE =
  "This vehicle has no active licence. Activate it on the Licences page before assigning it.";

// Matches the sentence the trigger raises, so an RPC caller that rethrows only
// `error.message` (for example `new Error(\`save failed: ${error.message}\`)`)
// is still recognised. Anchored on the full second sentence rather than the
// words "no active licence" alone, which could appear in unrelated copy.
const SENTENCE =
  /Vehicle .{1,80}? has no active licence\. Activate it on the Licences page before assigning it\./;

type ErrorLike = {
  code?: unknown;
  hint?: unknown;
  message?: unknown;
};

function asErrorLike(error: unknown): ErrorLike | null {
  if (error === null || typeof error !== "object") return null;
  return error as ErrorLike;
}

export function isUnlicensedVehicleError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (!e) return false;
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
  if (e && isUnlicensedVehicleError(error) && typeof e.message === "string") {
    const match = e.message.match(SENTENCE);
    if (match) return match[0];
  }
  return FALLBACK_MESSAGE;
}
