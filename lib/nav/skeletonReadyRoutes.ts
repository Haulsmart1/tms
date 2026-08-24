/* THE SECOND ACTIVATION SWITCH, sibling to themeableRoutes.ts.

   A route on this list has been converted to draw its own loading skeleton, so
   TenantGate passes through instead of blocking, and AppShell renders during
   tenant resolution instead of hiding. The user lands on a recognisable page
   from the first frame rather than a bare dark panel with "Loading..." on it.

   A route NOT on this list keeps the old behaviour exactly: TenantGate blocks,
   the sidebar stays hidden. That is the safe default, and it is why this is an
   allowlist rather than a denylist.

   TO ADD A ROUTE, in this order and not before:
   1. Its loader early-returns unless useTenant().status === "ready", with
      status in the effect's dependency array.
   2. Every region that reads data renders a skeleton via shouldShowSkeleton
      (lib/loading/skeletonVisibility.ts), including regions that currently
      render an empty state. A page listed here without step 2 will show its
      "nothing found" copy as a statement of fact while the query is in flight.
   3. Then add the path below.

   Adding a path before steps 1 and 2 is the one way to make this change worse
   than what it replaced. See the spec for the four pages that already do this.

   When every route is listed, this file, its test, and TenantGate's loading
   panel can all be deleted in one commit. */
export const SKELETON_READY_ROUTES: readonly string[] = [
  // Populated per page. /dashboard and /customers land in this batch.
];

export function isSkeletonReadyRoute(pathname: string): boolean {
  // Exact match, not prefix, and trailing-slash tolerant. Same normalisation as
  // isThemeableRoute in ./themeableRoutes.ts; keep the two in step.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return SKELETON_READY_ROUTES.includes(normalized);
}
