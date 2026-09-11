/* The confirm-button gate for the tenant re-parent dialog in
   app/super-admin/companies/[id]/page.tsx. Pure and tested here because
   vitest cannot reach anything under app/ (vitest.config.ts's test glob is
   scoped to the lib directory only), and this predicate IS the safety
   mechanism for an irreversible write that moves every job, POD, invoice,
   vehicle and driver under a tenant to a different company. It needs to be
   provably correct, not merely correct by inspection of a component that
   cannot be unit tested. */

export type MoveCounts = {
  // Which tenant these counts describe. Required, not optional: a counts
  // object with no tenantId could accidentally satisfy the gate for
  // whichever tenant the dialog happens to be showing, which is the exact
  // failure this type exists to make unrepresentable.
  tenantId: string;
  vehicles: number;
  billableVehicles: number;
  users: number;
};

export type MoveCountsError = {
  tenantId: string;
  message: string;
};

/**
 * The tenant name (or id, if it has none) the operator must type verbatim
 * to enable the confirm button. Shared by the gate below and by the page so
 * the label it renders and the check it performs can never say two
 * different things.
 */
export function requiredMoveConfirmText(tenant: { id: string; name: string | null } | null): string {
  if (!tenant) return "";
  return (tenant.name || tenant.id).trim();
}

export function canConfirmMove(args: {
  tenant: { id: string; name: string | null } | null;
  counts: MoveCounts | null;
  countsError: MoveCountsError | null;
  target: string;
  typed: string;
  busy: boolean;
}): boolean {
  const { tenant, counts, countsError, target, typed, busy } = args;

  if (!tenant) return false;
  if (busy) return false;
  if (!target) return false;

  // A count read that failed for THIS tenant blocks the gate outright: an
  // unreadable fleet size must never be treated as "0, so it's fine".
  if (countsError && countsError.tenantId === tenant.id) return false;

  // Keyed, not merely present. This is the structural fix for the bug where
  // Move is opened on tenant A, cancelled, then opened on tenant B before
  // A's counts round trip resolves: A's response lands with moving === B,
  // and an un-keyed `!counts` check would happily let the operator type B's
  // name and confirm while looking at A's fleet. Comparing tenantId makes a
  // stale response for a different tenant fail this gate by construction,
  // rather than by a generation counter someone has to remember to check at
  // every return point.
  if (!counts || counts.tenantId !== tenant.id) return false;

  // Case- and whitespace-strict, deliberately, for a destructive gate. The
  // point of "type the tenant's name" is to make the operator actually read
  // it, not to pattern-match a fragment: a looser comparison ("acme"
  // satisfying "Acme Haulage Ltd", or collapsed internal whitespace
  // satisfying "Acme  Haulage") would quietly turn this back into a single
  // click. Do not loosen this without re-reading why it is strict.
  return typed.trim() === requiredMoveConfirmText(tenant);
}
