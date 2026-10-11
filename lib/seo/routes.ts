// An explicit indexing allowlist, independent of the authentication allowlist.
// Being accessible without a session does NOT make a customer link indexable.
export const MARKETING_PATHS = [
  "/",
  "/contact",
  "/features",
  "/features/transport-job-management",
  "/features/electronic-proof-of-delivery",
  "/features/transport-invoicing",
  "/guides/choosing-transport-management-software",
] as const;

export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.some((path) => path === pathname);
}

// Public presentation does not imply indexing: the form return page is not
// marketing content and remains noindex and absent from the sitemap.
export function isPublicMarketingSurface(pathname: string): boolean {
  return isMarketingPath(pathname) || pathname === "/contact/thank-you";
}
