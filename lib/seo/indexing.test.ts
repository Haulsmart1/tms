import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { privateHeaderSource } from "./indexing";
import { MARKETING_PATHS } from "./routes";
import { LEGAL_PATHS } from "../legal/routes";
import { isPublicPath } from "../auth/publicRoutes";
import { shouldShowShell } from "../nav/shouldShowShell";
import { jsonLd, publicMetadata, SITE_ORIGIN } from "./site";
import sitemap from "../../app/sitemap";

const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};

describe("public indexing boundary", () => {
  // Compile with Next's actual route parser, rather than a similar regex.
  const privateHeader = pathToRegexp(privateHeaderSource());

  it.each([...MARKETING_PATHS, ...LEGAL_PATHS, "/robots.txt", "/sitemap.xml", "/social-preview"])(
    "does not blanket-noindex a public document: %s", (path) => {
      expect(privateHeader.test(path)).toBe(false);
      if (path !== "/") expect(privateHeader.test(`${path}/`)).toBe(false);
    },
  );

  it.each(["/contact/thank-you", "/login", "/signup", "/auth/confirm", "/jobs", "/planning", "/tracking", "/customers", "/invoices", "/load-transfer", "/driver/dashboard", "/driver/jobs/abc", "/settings", "/super-admin", "/pod/share/abc.def", "/quotation/share/token", "/track/token", "/api/pod/share/token/pdf", "/api/public/track/token", "/features/private-future-page", "/terms/private-future-page", "/unknown"])(
    "sends noindex for private, auth, token and unknown paths: %s", (path) => {
      expect(privateHeader.test(path)).toBe(true);
    },
  );

  it("keeps operational routes authenticated while opening only exact marketing paths", () => {
    for (const path of MARKETING_PATHS) {
      expect(isPublicPath(path)).toBe(true);
      expect(shouldShowShell(path, "ready")).toBe(false);
    }
    for (const path of ["/jobs", "/planning", "/invoices", "/features/internal", "/guides/internal", "/contact/internal"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("keeps the public form return page out of the sitemap and application shell", () => {
    expect(isPublicPath("/contact/thank-you")).toBe(true);
    expect(shouldShowShell("/contact/thank-you", "ready")).toBe(false);
    expect(sitemap().some((entry) => entry.url.endsWith("/contact/thank-you"))).toBe(false);
  });

  it("lists only canonical public pages in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(`${SITE_ORIGIN}/`);
    for (const url of urls) {
      const path = new URL(url).pathname;
      expect([...MARKETING_PATHS, ...LEGAL_PATHS]).toContain(path);
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("uses a page-specific canonical and social URL, without query parameters", () => {
    const metadata = publicMetadata("/features", "Features", "Description");
    expect(metadata.alternates?.canonical).toBe(`${SITE_ORIGIN}/features`);
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_ORIGIN}/features` });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("escapes script-closing text in structured data", () => {
    const serialized = jsonLd({ name: "</script><script>example</script>" });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized).name).toBe("</script><script>example</script>");
  });
});
