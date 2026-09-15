import type { NextConfig } from "next";

/*
  Security response headers (review SET-16). This file exists only for
  headers(); it sets no other option, so every build default is unchanged.

  Deliberately NOT a script-src Content-Security-Policy: the synchronous theme
  script in app/layout.tsx (lib/theme/themeScript.ts) and the landing page's
  JSON-LD are inline, and a script CSP without their hashes would silently
  break light mode. frame-ancestors is the only CSP directive sent.

  Permissions-Policy keeps camera and geolocation for this origin: the driver
  app scans barcodes and records POD locations. Nothing in the app frames its
  own pages, so DENY breaks nothing.
*/
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
