// May this licence be deleted, or only deactivated? Pure; the route loads the
// row and calls this.

export type LicenceDeleteAction =
  | { kind: "delete" }
  | { kind: "blocked"; reason: "was_active" };

/**
 * The rule differs by billing model, and conflating them was a live
 * regression.
 *
 * Under v1 the cycle is PREPAID, and `vehicle_cycle_coverage` records what a
 * payment actually bought. billing_03 therefore kept the browser's delete
 * grant on purpose: removing a licence can only reduce a bill, so there is
 * nothing for the server to settle first, and a delete-then-reinsert inside
 * one cycle is free anyway. Nothing about that reasoning changed.
 *
 * Under v2 the invoice is computed at period close FROM these rows. A licence
 * that was ever live is the evidence that a vehicle was billable, so deleting
 * it makes that vehicle silently vanish from an invoice it belonged on.
 *
 * A blanket ban would have been the obvious response and is worse than it
 * looks, because the case that actually happens is a typo. So delete survives
 * under v2, narrowed to a licence that was never activated: it has bought
 * nothing. The test is `deactivated_at` equal to `activated_at`, which is the
 * zero-length shape both the sync trigger and the billing_07 backfill produce
 * for a row that was never live. Anything that ran for even a second has
 * `deactivated_at` strictly greater.
 *
 * Fails CLOSED on a missing lifecycle. A row with no dates cannot be shown to
 * have bought nothing, and guessing in the direction of deleting billing
 * evidence is the wrong way round.
 */
export function selectLicenceDeleteAction(args: {
  isPeriodBilling: boolean;
  active: boolean | null;
  activatedAtISO: string | null;
  deactivatedAtISO: string | null;
}): LicenceDeleteAction {
  if (!args.isPeriodBilling) return { kind: "delete" };

  if (args.active === true) return { kind: "blocked", reason: "was_active" };
  if (args.activatedAtISO === null || args.deactivatedAtISO === null) {
    return { kind: "blocked", reason: "was_active" };
  }

  const neverActivated =
    Date.parse(args.deactivatedAtISO) <= Date.parse(args.activatedAtISO);

  return neverActivated
    ? { kind: "delete" }
    : { kind: "blocked", reason: "was_active" };
}
