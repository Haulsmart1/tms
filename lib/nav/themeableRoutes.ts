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

   When every route is listed, this file and app/components/ThemeScope.tsx can
   both be deleted in one commit. */
export const THEMEABLE_ROUTES: readonly string[] = [
  "/",                       // app/page.tsx:50          (pinned light, see spec)
  "/login",                  // app/login/page.tsx:62
  "/dashboard",              // app/dashboard/page.tsx:184
  "/jobs",                   // app/jobs/page.tsx:249
  "/super-admin/requests",   // app/super-admin/requests/page.tsx:79
];

export function isThemeableRoute(pathname: string): boolean {
  // Exact match, not prefix: "/super-admin/requests" is tokenised but its
  // siblings under /super-admin are not, so a prefix match would wrongly theme
  // the whole area.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return THEMEABLE_ROUTES.includes(normalized);
}
