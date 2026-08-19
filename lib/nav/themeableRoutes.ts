/* THE ACTIVATION SWITCH.

   A route on this list follows the light/dark theme and shows the theme toggle.
   A route not on it is pinned dark by ThemeScope, because the remaining legacy
   pages are styled with hardcoded inline colour literals that cannot respond to
   a theme class. Letting them follow the theme would put their dark-tuned text
   on a light background: /super-admin would render white-on-white.

   SEVEN LEGACY PAGES ARE LEFT, all of them deliberately absent below:
   /driver/dashboard, /subcontractor/dashboard, and the five non-requests
   /super-admin pages. Every other route in the app has been converted and is
   listed here.

   TO ACTIVATE A LEGACY PAGE: convert its inline colour literals to tokens, give
   its root element `className="ds ... bg-canvas text-ink"` the way the pages
   below do, then add its path here. That is the whole procedure. /pod was the
   first page converted this way after the switch existed, and it took exactly
   those three steps.

   This is an allowlist, not a denylist, so a brand new page defaults to
   pinned-dark and legacy-safe rather than half-themed.

   THREE ENTRIES BELOW DO NOT SHOW A TOGGLE, and that is correct. AppShell is
   what renders the toggle, and shouldShowShell() hides AppShell entirely on
   "/", "/login" and every "/super-admin/*" path. Those three still need to be
   listed, because this list ALSO decides whether ThemeScope pins a route dark,
   and pinning the landing page or /login dark would be wrong. Every other
   route here offers the control.

   "/" is a further special case: it self-pins `.light` on its own root element
   (see app/page.tsx), because the public marketing page stays light whatever
   the console is set to. Listing it here is therefore belt-and-braces rather
   than load-bearing, since the nearer `.light` would win over ThemeScope's
   `.dark` anyway. Removing it would render identically; it is kept so the list
   reads as "every tokenised page" rather than "every page ThemeScope must skip".

   Deliberately NO line numbers in the annotations below. They were wrong twice
   during this branch alone, because the referenced lines move whenever anything
   is added above them.

   When every route is listed, this file and app/components/ThemeScope.tsx can
   both be deleted in one commit. */
export const THEMEABLE_ROUTES: readonly string[] = [
  "/",                        // app/page.tsx                      (self-pins .light)
  "/login",                   // app/login/page.tsx                (no shell, no toggle)
  "/super-admin/requests",    // app/super-admin/requests/page.tsx (no shell, no toggle)
  "/dashboard",               // app/dashboard/page.tsx
  "/jobs",                    // app/jobs/page.tsx
  "/planning",                // app/planning/page.tsx
  "/pod",                     // app/pod/page.tsx
  "/tracking",                // app/tracking/page.tsx
  "/drivers",                 // app/drivers/page.tsx
  "/assets",                  // app/assets/page.tsx
  "/maintenance",             // app/maintenance/page.tsx
  "/vehicles",                // app/vehicles/page.tsx
  "/customers",               // app/customers/page.tsx
  "/subcontractors",          // app/subcontractors/page.tsx
  "/invoices",                // app/invoices/page.tsx
  "/stats",                   // app/stats/page.tsx
  "/tachograph",              // app/tachograph/page.tsx
  "/telematics",              // app/telematics/page.tsx
  "/settings",                // app/settings/page.tsx
  "/settings/users",          // app/settings/users/page.tsx
  "/settings/permissions",    // app/settings/permissions/page.tsx
  "/settings/invoices",       // app/settings/invoices/page.tsx
  "/settings/portal-invites", // app/settings/portal-invites/page.tsx
  "/settings/licences",       // app/settings/licences/page.tsx
  "/settings/company",        // app/settings/company/page.tsx
];

export function isThemeableRoute(pathname: string): boolean {
  // Exact match, not prefix: "/super-admin/requests" is tokenised but its
  // siblings under /super-admin are not, so a prefix match would wrongly theme
  // the whole area.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return THEMEABLE_ROUTES.includes(normalized);
}
