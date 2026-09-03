import type { TenantStatus } from "../tenant/context";

type Args = {
  /** From useTenant().status. */
  tenantStatus: TenantStatus;
  /** The page's own in-flight query. */
  fetching: boolean;
  /** Whether this region has already rendered real content at least once. */
  hasData: boolean;
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
   is opened, so a list that feeds only a <select> needs no flag. */
export function shouldShowSkeleton({ tenantStatus, fetching, hasData }: Args): boolean {
  // Never flash a skeleton over content that is already on screen.
  if (hasData) return false;
  return tenantStatus !== "ready" || fetching;
}
