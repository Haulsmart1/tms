import type { Metadata } from "next";

// The marketing origin specified in the SEO brief. Never derive canonicals
// from a request Host header or a preview deployment's hostname.
export const SITE_ORIGIN = "https://tmswizard.cloud";
export const SITE_NAME = "TMS Wizard";
export const PRIVATE_ROBOTS = { index: false, follow: false } as const;

export function publicMetadata(path: string, title: string, description: string): Metadata {
  const url = `${SITE_ORIGIN}${path === "/" ? "/" : path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      title, description, url, type: "website", locale: "en_GB", siteName: SITE_NAME,
      images: [{ url: `${SITE_ORIGIN}/social-preview`, width: 1200, height: 630, alt: "TMS Wizard: jobs, proof of delivery and transport invoicing" }],
    },
    twitter: {
      card: "summary_large_image", title, description,
      images: [`${SITE_ORIGIN}/social-preview`],
    },
  };
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
