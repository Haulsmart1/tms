/* THE ACTIVATION SWITCH.

   A route on this list follows the light/dark theme and shows the theme toggle.
   A route not on it is pinned dark by ThemeScope. That existed because the
   legacy pages were styled with hardcoded inline colour literals that cannot
   respond to a theme class: letting them follow the theme would have put their
   dark-tuned text on a light background, and /super-admin would have rendered
   white-on-white. Every console route is now tokenised, so the mechanism is
   still load-bearing only for NEW pages, which default to pinned-dark until
   someone lists them.

   NO LEGACY CONSOLE PAGES ARE LEFT. The seven that used to be excluded
   (/driver/dashboard, /subcontractor/dashboard and the five non-requests
   /super-admin pages) have all been converted to tokens and are listed below.

   TO ACTIVATE A LEGACY PAGE: convert its inline colour literals to tokens, give
   its root element `className="ds ... bg-canvas text-ink"` the way the pages
   below do, then add its path here. That is the whole procedure. /pod was the
   first page converted this way after the switch existed, and it took exactly
   those three steps.

   WHAT IS STILL NOT LISTED, and why: the two share-token pages
   (/pod/share/[token], /quotation/share/[token]) and /driver/jobs/[jobId] are
   customer- and driver-facing pages outside the console shell, styled with a
   fixed light palette on purpose. They are not "legacy" in the sense this file
   used to mean; do not add them without deciding that a recipient opening a
   delivery receipt should see the operator's theme.

   This is an allowlist, not a denylist, so a brand new page defaults to
   pinned-dark and legacy-safe rather than half-themed.

   EIGHT ENTRIES BELOW DO NOT SHOW A TOGGLE, and that is correct. AppShell is
   what renders the toggle, and shouldShowShell() hides AppShell entirely on
   "/", "/login" and every "/super-admin/*" path, which is now six routes rather
   than one. They all still need listing, because this list ALSO decides whether
   ThemeScope pins a route dark, and pinning the landing page or /login dark
   would be wrong. The two portal dashboards (/driver, /subcontractor) DO offer
   the control, so converting them is the one part of this change a user can
   actually see a toggle for.

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
  "/super-admin",             // app/super-admin/page.tsx           (no shell, no toggle)
  "/super-admin/requests",    // app/super-admin/requests/page.tsx (no shell, no toggle)
  "/super-admin/billing",     // app/super-admin/billing/page.tsx  (no shell, no toggle)
  "/super-admin/companies",   // app/super-admin/companies/page.tsx (no shell, no toggle)
  "/super-admin/invoices",    // app/super-admin/invoices/page.tsx (no shell, no toggle)
  "/super-admin/users",       // app/super-admin/users/page.tsx    (no shell, no toggle)
  "/auth/confirm",            // app/auth/confirm/page.tsx
  "/driver/dashboard",        // app/driver/dashboard/page.tsx
  "/subcontractor/dashboard", // app/subcontractor/dashboard/page.tsx
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
  "/settings/billing",        // app/settings/billing/page.tsx
  "/settings/documents",      // app/settings/documents/page.tsx
];

/* The ONLY prefix rule, and it stays that way. /super-admin/companies/[id] is
   the first dynamic console route that has to follow the theme: pinned dark, it
   would be the one page in the area that ignores the toggle, sitting one click
   from the list page that obeys it.

   A blanket prefix match was the obvious alternative and is wrong. It would
   theme /driver/jobs/[jobId] along with /driver/dashboard, and that page is
   excluded on purpose: it is driver-facing, outside the console shell, on a
   fixed light palette. Listing the one prefix that needs it keeps exact match
   as the default and keeps the deliberate exclusions deliberate. */
const THEMEABLE_ROUTE_PREFIXES = [
  "/super-admin/companies/", // app/super-admin/companies/[id]/page.tsx
];

export function isThemeableRoute(pathname: string): boolean {
  // Exact match by default, not prefix. Every other /super-admin route is
  // tokenised now, so that area no longer motivates a broad prefix rule, but
  // /driver does: /driver/dashboard is listed while /driver/jobs/[jobId] is
  // deliberately not, and a blanket prefix match would theme the driver job
  // page along with it. THEMEABLE_ROUTE_PREFIXES above is the one narrow
  // exception, scoped to the single dynamic route that needs it.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (
    THEMEABLE_ROUTES.includes(normalized) ||
    THEMEABLE_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}
