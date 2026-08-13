/* THE ACTIVATION SWITCH.

   A route on this list follows the light/dark theme and shows the theme toggle.
   A route not on it is pinned dark by ThemeScope, because the ~14 legacy pages
   are styled with hardcoded inline colour literals that cannot respond to a
   theme class. Letting them follow the theme would put their dark-tuned text on
   a light background: /tracking would render white-on-white.

   TO ACTIVATE A LEGACY PAGE: convert its inline colour literals to tokens, give
   its root element `className="ds ... bg-canvas text-ink"` the way the five
   pages below do, then add its path here. That is the whole procedure.

   This is an allowlist, not a denylist, so a brand new page defaults to
   pinned-dark and legacy-safe rather than half-themed.

   TWO ENTRIES BELOW DO NOT SHOW A TOGGLE, and that is correct. AppShell is what
   renders the toggle, and shouldShowShell() hides AppShell entirely on "/",
   "/login" and every "/super-admin/*" path. So of the five routes here, only
   /dashboard and /jobs actually offer the control. The others still need to be
   listed, because this list ALSO decides whether ThemeScope pins a route dark,
   and pinning the landing page or /login dark would be wrong.

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
  "/",                       // app/page.tsx                      (self-pins .light)
  "/login",                  // app/login/page.tsx
  "/dashboard",              // app/dashboard/page.tsx
  "/jobs",                   // app/jobs/page.tsx
  "/super-admin/requests",   // app/super-admin/requests/page.tsx
];

export function isThemeableRoute(pathname: string): boolean {
  // Exact match, not prefix: "/super-admin/requests" is tokenised but its
  // siblings under /super-admin are not, so a prefix match would wrongly theme
  // the whole area.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return THEMEABLE_ROUTES.includes(normalized);
}
