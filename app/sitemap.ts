import type { MetadataRoute } from "next";
import { allLegalDocuments } from "../lib/legal/documents";
import { documentStatus } from "../lib/legal/text";
import { MARKETING_PATHS } from "../lib/seo/routes";
import { SITE_ORIGIN } from "../lib/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const publishedPolicies = allLegalDocuments()
    .filter((doc) => !documentStatus(doc.content).draft)
    .map((doc) => doc.path);
  // No fabricated freshness dates; only canonical public documents belong here.
  return [...MARKETING_PATHS, "/legal", ...publishedPolicies]
    .map((path) => ({ url: `${SITE_ORIGIN}${path}` }));
}
