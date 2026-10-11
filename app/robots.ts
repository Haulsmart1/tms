import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Allow crawlers to see noindex on auth and token pages. Disallowing them
    // would prevent removal of an already discovered URL. Auth still gates data.
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
