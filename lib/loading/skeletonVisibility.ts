import type { TenantStatus } from "../tenant/context";

type Args = {
  /** From useTenant().status. */
  tenantStatus: TenantStatus;
  /** The page's own in-flight query. */
  fetching: boolean;
  /** Whether this region has already rendered real content at least once. */
  hasData: boolean;
  /** From useTenant().activeTenantId. Null legitimately means "All tenants". */
  activeTenantId: string | null;
  /** The tenant the on-screen content was loaded FOR. `undefined` before any
   *  load has completed, which is deliberately distinct from `null`. */
  dataTenantId: string | null | undefined;
};

/* The single rule for whether a loading region shows its skeleton.
   Extracted here rather than inlined per page for one reason: vitest covers
   lib/ only, and the hasData short circuit below is a real regression guard
   that needs a test. See skeletonVisibility.test.ts.

   ONE FLAG PER REGION, NOT PER PAGE. hasData short circuits, so a flag keyed
   on region A's data reports "not loading" for region B, which then renders
   its empty state as fact. That was a real bug on /vehicles.

   A REGION IS DEFINED BY ITS DATA, NOT BY ITS CONTAINER. Two containers that
   read the same state are one region: they share one flag and ONE sr-only
   role="status" announcement, and each container carries its own aria-busy.
   /settings/licences is the worked example, where the Stat row and the card
   grid both read `licences` and are separated by the add form. Do not read
   the single-container comment in app/vehicles/page.tsx as forbidding this;
   what it forbids is two containers for the SAME list, one skeleton and one
   real, whose layout classes then drift apart.

   FORM CONTROLS ARE EXCLUDED. A <select>'s options are not visible until it
   is opened, so a list that feeds only a <select> needs no flag.

   CONTENT IS "ALREADY ON SCREEN" ONLY FOR THE TENANT IT WAS LOADED FOR. The
   hasData short circuit above predates the tenant selector's activeTenantId
   comparison: without it, switching tenants left hasData true (the previous
   tenant's rows were still rendered) and the skeleton never showed, so the
   page kept displaying the previous tenant's data under the new tenant's
   selection until the new fetch landed. dataTenantId is three-valued
   (string | null | undefined) because `undefined` ("never loaded") must not
   equal `null` ("All tenants"): collapsing them would show stale content for
   a page that has never queried anything. */
export function shouldShowSkeleton({
  tenantStatus,
  fetching,
  hasData,
  activeTenantId,
  dataTenantId,
}: Args): boolean {
  // Never flash a skeleton over content that is already on screen for the
  // tenant currently selected.
  if (hasData && dataTenantId === activeTenantId) return false;
  return tenantStatus !== "ready" || fetching;
}
