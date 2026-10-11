import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const origin = process.env.SEO_TEST_ORIGIN || "http://127.0.0.1:3107";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "SEO checks must target localhost");
const canonicalOrigin = "https://tmswizard.cloud";
const routes = ["/", "/contact", "/features", "/features/transport-job-management", "/features/electronic-proof-of-delivery", "/features/transport-invoicing", "/guides/choosing-transport-management-software", "/legal", "/terms", "/privacy", "/cookies", "/cancellation-policy", "/dpa", "/accessibility", "/support-policy", "/acceptable-use", "/sub-processors", "/security"];
const results = [];
for (const path of routes) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get("x-robots-tag"), null, path);
  const html = await response.text();
  assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `${path}: one H1`);
  assert(html.includes(`rel="canonical" href="${canonicalOrigin}${path === "/" ? "" : path}"`), `${path}: canonical`);
  assert(html.includes('name="robots" content="index, follow"'), `${path}: indexable metadata`);
  assert(html.includes('property="og:image"'), `${path}: social image`);
  assert(html.includes('name="twitter:card" content="summary_large_image"'), `${path}: Twitter card`);
  assert(html.includes('href="/contact"'), `${path}: contact navigation`);
  assert(html.includes('href="mailto:support@tmswizard.com"'), `${path}: official email`);
  assert(html.includes('href="tel:08009991263"'), `${path}: official telephone`);
  assert(html.includes("0800 999 1263"), `${path}: visible telephone`);
  assert(!html.includes("it@silverlady.group"), `${path}: no obsolete displayed email`);
  assert(!html.includes('href="/#request-access"'), `${path}: no obsolete contact link`);
  assert(!html.includes('action="/api/request-access"'), `${path}: no old intake form`);
  if (path === "/contact") {
    assert(html.includes('action="https://formsubmit.co/support@tmswizard.com"'));
    assert(html.includes('method="POST"'));
    assert(html.includes('name="_honey"'));
    assert(!html.includes('name="_captcha"'));
    assert(html.includes('name="_next" value="https://tmswizard.cloud/contact/thank-you"'));
    assert(!/\snovalidate\b/i.test(html), "Native no-JS validation remains enabled");
  }
  const structured = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1]));
  if (path === "/") {
    assert(html.includes("Speak to the team:"), "Homepage offers a prominent telephone link near the primary CTA");
    const app = structured.flatMap((value) => value["@graph"] || []).find((value) => value["@type"] === "SoftwareApplication");
    assert.equal(app?.offers?.price, "129.00");
    assert(app?.offers?.description?.includes("28-day"));
    assert(!JSON.stringify(app).includes("aggregateRating"));
  }
  results.push({ path, status: response.status, htmlBytes: Buffer.byteLength(html), structuredDataBlocks: structured.length });
}

const protectedPages = ["/dashboard", "/jobs", "/planning", "/driver/dashboard", "/driver/jobs/test-job", "/driver/walkaround", "/load-transfer", "/pod", "/invoices", "/settings/integrations", "/settings/permissions", "/features/not-public"];
for (const path of ["/contact/thank-you", "/login", "/signup", "/auth/confirm", ...protectedPages, "/api/assistant?area=jobs", "/api/integrations/catalogue", "/pod/share/seo-test-token", "/pod/share/seo.test.token", "/quotation/share/seo-test-token", "/track/seo-test-token", "/api/pod/share/seo-test-token/pdf", "/api/public/track/seo-test-token"]) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual" });
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", `${path}: private header`);
  if (protectedPages.includes(path)) {
    assert.equal(response.status, 307, `${path}: auth redirect`);
    assert(new URL(response.headers.get("location"), origin).pathname === "/login");
  }
  if (["/api/assistant?area=jobs", "/api/integrations/catalogue"].includes(path)) {
    assert.equal(response.status, 401, `${path}: API authentication retained`);
  }
  if (["/contact/thank-you", "/login", "/signup", "/auth/confirm"].includes(path)) {
    const html = await response.text();
    assert(html.includes('name="robots" content="noindex, nofollow"'), `${path}: private metadata`);
    assert(!html.includes('rel="canonical"'), `${path}: no inherited homepage canonical`);
  }
  results.push({ path, status: response.status, robots: response.headers.get("x-robots-tag") });
}
const robotsResponse = await fetch(`${origin}/robots.txt`);
assert.equal(robotsResponse.status, 200);
const robots = await robotsResponse.text();
assert(robots.includes("Allow: /"));
assert(robots.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`));
assert(!robots.includes("Disallow:"));
const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
assert.equal(sitemapResponse.status, 200);
const sitemap = await sitemapResponse.text();
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.deepEqual(locations.sort(), routes.map((path) => `${canonicalOrigin}${path}`).sort());
const imageResponse = await fetch(`${origin}/social-preview`);
assert.equal(imageResponse.status, 200);
assert(imageResponse.headers.get("content-type").includes("image/png"));
const bytes = Buffer.from(await imageResponse.arrayBuffer());
assert.equal(bytes.subarray(1, 4).toString(), "PNG");
assert.equal(bytes.readUInt32BE(16), 1200);
assert.equal(bytes.readUInt32BE(20), 630);
const queryResponse = await fetch(`${origin}/features?utm_source=seo-test`);
assert((await queryResponse.text()).includes(`rel="canonical" href="${canonicalOrigin}/features"`));
mkdirSync(".verification/seo-artifacts", { recursive: true });
writeFileSync(".verification/seo-artifacts/brand-social-preview.png", bytes);
writeFileSync(".verification/seo-artifacts/http-results.json", JSON.stringify({ origin, pages: results, sitemapUrls: locations.length, socialImageBytes: bytes.length }, null, 2));
console.log(`PASS: ${routes.length} public pages, ${results.length - routes.length} noindex/auth/token responses, sitemap, robots, query canonical and 1200x630 social image.`);
