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
   that needs a test. See skeletonVisibility.test.ts. */
export function shouldShowSkeleton({ tenantStatus, fetching, hasData }: Args): boolean {
  // Never flash a skeleton over content that is already on screen.
  if (hasData) return false;
  return tenantStatus !== "ready" || fetching;
}
