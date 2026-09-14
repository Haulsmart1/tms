import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicRoutes";

/*
  Every page and route handler under app/ must be classified on purpose.

  deec4cd fixed the proxy.ts matcher (AUTH-1), so the edge gate now runs on
  every route. A route that should be public but is missing from
  lib/auth/publicRoutes.ts starts 401ing or redirecting to /login; a route
  that should be private but matches a public entry is reachable anonymously.
  This test walks app/ on disk, so adding a route without deciding which list
  it belongs in fails here rather than in production.

  To add a route: put its template path (dynamic segments as written on disk,
  e.g. "/api/jobs/[jobId]") in exactly one list below. If it goes in PUBLIC,
  it must also be matched by lib/auth/publicRoutes.ts and must authenticate
  itself (a token, a bearer secret, or a rate limit for true intake forms).
*/

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/auth/confirm",
  "/api/auth/callback",
  "/api/auth/magic-link",
  "/api/request-access",
  "/api/billing/run",
  "/api/integrations/cambridge-audio/rma",
  "/pod/share/[token]",
  "/api/pod/share/[token]/pdf",
  "/quotation/share/[token]",
  "/api/public/quotation-share/[token]",
  "/api/public/quote-request/[token]",
];

/* Signed-in only. Drivers and subcontractors are ordinary Supabase auth users
   (driver_users / subcontractor_users link them), so their portals sit behind
   the gate like the console. OAuth returns (Xero) and Stripe onboarding
   returns are top-level navigations that carry the SameSite=Lax session
   cookie, and their handlers require a session anyway. */
const PROTECTED_ROUTES = [
  "/api/accounts/accounting",
  "/api/accounts/accounting/xero/callback",
  "/api/accounts/accounting/xero/connect",
  "/api/accounts/accounting/xero/disconnect",
  "/api/accounts/accounting/xero/invoices/[id]/sync",
  "/api/accounts/accounting/xero/setup",
  "/api/accounts/accounting/xero/status",
  "/api/accounts/accounting/xero/test",
  "/api/accounts/chase-letters",
  "/api/accounts/credit-notes",
  "/api/accounts/invoices",
  "/api/accounts/invoices/[id]",
  "/api/accounts/invoices/[id]/email",
  "/api/accounts/lookups",
  "/api/accounts/payments",
  "/api/accounts/purchase-orders",
  "/api/accounts/quotations",
  "/api/accounts/quotations/[id]/convert",
  "/api/accounts/quotations/[id]/email",
  "/api/accounts/quotations/[id]/share",
  "/api/accounts/quote-requests",
  "/api/accounts/ready-to-invoice",
  "/api/accounts/statements",
  "/api/billing/cancel",
  "/api/billing/card",
  "/api/billing/preview",
  "/api/customers",
  "/api/customers/[id]",
  "/api/driver/jobs/[jobId]",
  "/api/driver/jobs/[jobId]/stops/[stopId]/complete",
  "/api/driver/jobs/[jobId]/stops/[stopId]/evidence",
  "/api/driver/jobs/[jobId]/stops/[stopId]/scans",
  "/api/driver/load-manifests/scan",
  "/api/driver/location",
  "/api/driver/me",
  "/api/jobs/[jobId]",
  "/api/licences/activate",
  "/api/licences/estimate",
  "/api/load-manifests",
  "/api/pod/share",
  "/api/pod/share/email",
  "/api/pod/share/revoke",
  "/api/pod/evidence",
  "/api/pod/evidence/[evidenceId]",
  "/api/pod/evidence/upload-url",
  "/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url",
  "/api/settings/documents",
  "/api/settings/documents/logo",
  "/api/settings/payments/stripe/connect",
  "/api/settings/payments/stripe/status",
  "/api/settings/portal-invites",
  "/api/settings/users/[userId]",
  "/api/settings/users/invite",
  "/api/subcontractor/me",
  "/api/subcontractor/users/invite",
  "/api/subcontractors",
  "/api/super-admin/companies/[id]",
  "/api/super-admin/tenants/[id]",
  "/api/super-admin/users",
  "/api/tachograph/activity",
  "/api/tachograph/providers",
  "/api/tachograph/sync",
  "/api/tomtom/geocode",
  "/api/tomtom/matrix",
  "/api/tomtom/route",
  "/assets",
  "/customers",
  "/dashboard",
  "/driver/dashboard",
  "/driver/jobs/[jobId]",
  "/drivers",
  "/invoices",
  "/jobs",
  "/maintenance",
  "/planning",
  "/pod",
  "/settings",
  "/settings/billing",
  "/settings/company",
  "/settings/documents",
  "/settings/invoices",
  "/settings/licences",
  "/settings/permissions",
  "/settings/portal-invites",
  "/settings/users",
  "/stats",
  "/subcontractor/dashboard",
  "/subcontractors",
  "/super-admin",
  "/super-admin/billing",
  "/super-admin/companies",
  "/super-admin/companies/[id]",
  "/super-admin/invoices",
  "/super-admin/requests",
  "/super-admin/users",
  "/tachograph",
  "/telematics",
  "/tracking",
  "/vehicles",
];

const ROUTE_FILE = /^(page|route)\.(tsx|ts|jsx|js|mdx)$/;

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Private folders (_x) are not routable.
      if (entry.name.startsWith("_") || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (ROUTE_FILE.test(entry.name)) {
      out.push(full);
    }
  }
}

/* app/foo/(group)/@slot/[id]/page.tsx -> /foo/[id] */
function templateFor(appDir: string, file: string): string {
  const segments = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));
  return "/" + segments.join("/");
}

/* A concrete URL for a template, so isPublicPath is exercised the way the
   proxy sees it. */
function sampleUrl(template: string): string {
  return template.replace(/\[\[?(?:\.\.\.)?[^\]]+\]\]?/g, "sample-1");
}

function discoveredRoutes(): string[] {
  const appDir = join(__dirname, "..", "..", "app");
  const files: string[] = [];
  walk(appDir, files);
  return [...new Set(files.map((file) => templateFor(appDir, file)))].sort();
}

describe("route classification", () => {
  it("has no route in both lists", () => {
    const overlap = PUBLIC_ROUTES.filter((route) => PROTECTED_ROUTES.includes(route));
    expect(overlap).toEqual([]);
  });

  it("classifies every page and route handler under app/ deliberately", () => {
    const classified = new Set([...PUBLIC_ROUTES, ...PROTECTED_ROUTES]);
    const unclassified = discoveredRoutes().filter((route) => !classified.has(route));
    expect(unclassified, "add each new route to PUBLIC_ROUTES or PROTECTED_ROUTES").toEqual([]);
  });

  it("lists no route that no longer exists", () => {
    const onDisk = new Set(discoveredRoutes());
    const stale = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES].filter((route) => !onDisk.has(route));
    expect(stale).toEqual([]);
  });

  it.each(PUBLIC_ROUTES)("lets %s through the gate", (route) => {
    expect(isPublicPath(sampleUrl(route))).toBe(true);
  });

  it.each(PROTECTED_ROUTES)("gates %s", (route) => {
    expect(isPublicPath(sampleUrl(route))).toBe(false);
  });
});
