// Can a vehicle be hard-deleted? Pure decision core for DELETE
// /api/vehicles/[id]; the route loads the evidence counts (or asks the
// delete_vehicle_if_no_billing_evidence rpc, docs/sql/prodfix_31) and maps the
// answer through here.
//
// WHY THIS EXISTS (review SQL-5, SQL-12, SET-4, BILL2-12). The v2 close job
// finds a period's licences through the company's LIVE vehicle rows, and the
// v1 coverage and add-on charge rows cascade-deleted with the vehicle. So a
// browser delete of a vehicle, a day before its period closed, removed it from
// the invoice (v2) or erased the record of a payment already taken (v1),
// including a 'pending' add-on row whose Square outcome was still unknown.
//
// THE RULE. A vehicle carrying ANY billing evidence cannot be hard-deleted:
// a licence that was ever active, a coverage row, an add-on charge row of any
// status, or an invoice line. It is marked inactive instead, which keeps every
// record and stops it being used. A vehicle whose only licences never ran
// (the billing_07 zero-length draft shape) bought nothing, so it may go.

export type VehicleBillingEvidence = {
  everActiveLicences: number;
  coverageRows: number;
  addonChargeRows: number;
  invoiceLineRows: number;
};

export type VehicleDeleteDecision =
  | { kind: "allow" }
  | { kind: "refuse"; message: string };

export const VEHICLE_HAS_BILLING_EVIDENCE_MESSAGE =
  "This vehicle has billing history, so it cannot be deleted. Mark it inactive instead: its records are kept and it stops being used.";

export const VEHICLE_REFERENCED_MESSAGE =
  "This vehicle is still used by jobs or other records, so it cannot be deleted. Mark it inactive instead.";

/**
 * Was this licence ever live, even for a second?
 *
 * `undefined` lifecycle columns mean billing_07 is not applied, so there is no
 * history to read. That fails CLOSED: an unknown licence is kept as evidence,
 * because guessing "draft" is the direction that destroys an invoice record.
 */
export function isLicenceEverActive(licence: {
  active: boolean | null;
  activatedAt: string | null | undefined;
  deactivatedAt: string | null | undefined;
}): boolean {
  if (licence.active === true) return true;
  if (licence.activatedAt === undefined || licence.deactivatedAt === undefined) {
    return true;
  }
  if (licence.deactivatedAt === null) return true;
  if (licence.activatedAt === null) return true;

  const activated = Date.parse(licence.activatedAt);
  const deactivated = Date.parse(licence.deactivatedAt);
  if (Number.isNaN(activated) || Number.isNaN(deactivated)) return true;
  return deactivated > activated;
}

export function decideVehicleDelete(
  evidence: VehicleBillingEvidence
): VehicleDeleteDecision {
  const total =
    evidence.everActiveLicences +
    evidence.coverageRows +
    evidence.addonChargeRows +
    evidence.invoiceLineRows;
  return total > 0
    ? { kind: "refuse", message: VEHICLE_HAS_BILLING_EVIDENCE_MESSAGE }
    : { kind: "allow" };
}

export type VehicleDeleteHttp = {
  status: 200 | 404 | 409 | 500;
  body: { ok: true } | { error: string };
};

/**
 * Map the rpc's text answer to the route's contract. Anything unrecognised is
 * a 500, never a success: a delete we cannot confirm must not read as done.
 */
export function vehicleDeleteResponse(result: string | null | undefined): VehicleDeleteHttp {
  switch (result) {
    case "deleted":
      return { status: 200, body: { ok: true } };
    case "not_found":
      return { status: 404, body: { error: "Vehicle not found." } };
    case "has_billing_evidence":
      return { status: 409, body: { error: VEHICLE_HAS_BILLING_EVIDENCE_MESSAGE } };
    case "referenced":
      return { status: 409, body: { error: VEHICLE_REFERENCED_MESSAGE } };
    default:
      return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}

/** PostgREST PGRST202 or Postgres 42883: the rpc is not installed yet. */
export function isMissingRpcError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}
