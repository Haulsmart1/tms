/* THE SECOND ACTIVATION SWITCH, sibling to themeableRoutes.ts.

   A route on this list has been converted to draw its own loading skeleton, so
   TenantGate passes through instead of blocking, and AppShell renders during
   tenant resolution instead of hiding. The user lands on a recognisable page
   from the first frame rather than a bare dark panel with "Loading..." on it.

   A route NOT on this list keeps the old behaviour exactly: TenantGate blocks,
   the sidebar stays hidden. That is the safe default, and it is why this is an
   allowlist rather than a denylist.

   TO ADD A ROUTE, in this order and not before:
   1. The page actually renders <TenantGate>. Most do, but 22 route files do
      not, and listing one of those here would show the sidebar during tenant
      resolution while the page body rendered ungated beside it. Nothing can
      detect that for you: TenantGate cannot report that it was never used.
   2. Its loader early-returns unless useTenant().status === "ready", with
      status in the effect's dependency array. Note that TenantGate is an
      element inside each page's own JSX, not a wrapper around the component,
      so it has NEVER stopped a page's effects from firing during loading.
      This step is what stops the queries, and on most pages it is fixing a
      bug that is already there rather than preventing a new one.
   3. Every region that reads data renders a skeleton via shouldShowSkeleton
      (lib/loading/skeletonVisibility.ts), including regions that currently
      render an empty state. A page listed here without step 3 will show its
      "nothing found" copy as a statement of fact while the query is in flight.
   4. Then add the path below.

   Adding a path before steps 1 to 3 is the one way to make this change worse
   than what it replaced. See the spec for the four pages that already do this.

   WHEN EVERY ROUTE IS LISTED, the teardown is bigger than this file. In one
   commit: delete this file and its test, delete TenantGate's loading panel,
   AND unwind the two consumers, which will not compile without it.
     - lib/nav/shouldShowShell.ts collapses to
       `status === "ready" || status === "loading"`, since every non-exempt
       route is skeleton-ready by then.
     - app/components/TenantGate.tsx drops its isSkeletonReadyRoute branch and
       passes through unconditionally while loading.
   Both fail at build time rather than silently, so this is a reminder about
   scope, not a hazard. */
export const SKELETON_READY_ROUTES: readonly string[] = [
  "/dashboard",               // app/dashboard/page.tsx
  "/customers",               // app/customers/page.tsx
  "/settings/billing",        // app/settings/billing/page.tsx
  "/settings/licences",       // app/settings/licences/page.tsx
  "/settings/users",          // app/settings/users/page.tsx
  "/subcontractors",          // app/subcontractors/page.tsx
  "/vehicles",                // app/vehicles/page.tsx
];

export function isSkeletonReadyRoute(pathname: string): boolean {
  // Exact match, not prefix, and trailing-slash tolerant. Same normalisation as
  // isThemeableRoute in ./themeableRoutes.ts; keep the two in step.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return SKELETON_READY_ROUTES.includes(normalized);
}
