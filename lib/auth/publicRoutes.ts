/* The allowlist behind the edge auth gate in middleware.ts.
   Deny by default: anything not matched here requires a signed-in user.

   Kept in lib/ rather than inline in middleware.ts for two reasons: vitest only
   collects lib/**\/*.test.ts (see vitest.config.ts), and this file must stay free
   of next/server imports so the tests run without an edge runtime. */

/* Paths that are public and have no sub-paths. Matched exactly. */
const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/auth/confirm",
  /* Lead intake from the landing page form. Rate limiting is the route's own
     concern; it cannot require a session because the sender has no account. */
  "/api/request-access",
  /* Bearer-secret auth, checked inside the route handler. */
  "/api/integrations/cambridge-audio/rma",
  /* Vercel cron (see vercel.json). Authenticated by CRON_SECRET in an
     authorization header, and arrives with no session cookie at all, so the
     gate has to let it reach the handler that checks that secret. */
  "/api/billing/run",
]);

/* Prefixes that are public along with everything beneath them. Each entry
   matches the prefix itself or the prefix followed by "/", never a path that
   merely starts with the same characters ("/loginhack" must not match). */
const PUBLIC_PREFIXES = [
  /* Runs before a session exists: this is the route that creates one. */
  "/api/auth",
  /* HMAC-token gated customer links (lib/pod/shareToken.ts and siblings). The
     token is the credential; a session would defeat the point of sharing. */
  "/api/public",
  "/pod/share",
  "/quotation/share",
];

/* Public paths that need a shape, not a prefix.

   /api/pod/share is deliberately NOT a prefix entry. Its siblings
   /api/pod/share (POST, mints a share token) and /api/pod/share/email are
   staff-only; a prefix allowlist here would let an anonymous caller mint POD
   share tokens for any job. Only the token-gated PDF read is public. */
const PUBLIC_PATTERNS = [
  /^\/api\/pod\/share\/[^/]+\/pdf$/,
];

/* Collapses "." and ".." segments and duplicate slashes so that a crafted path
   cannot present as public here and resolve elsewhere downstream. Returns a
   path that always starts with exactly one "/". */
export function normalizePathname(pathname: string): string {
  const resolved: string[] = [];

  for (const segment of pathname.split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment === "..") {
      resolved.pop();
      continue;
    }

    resolved.push(segment);
  }

  return "/" + resolved.join("/");
}

export function isPublicPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  if (PUBLIC_EXACT.has(path)) return true;

  for (const prefix of PUBLIC_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + "/")) return true;
  }

  return PUBLIC_PATTERNS.some((pattern) => pattern.test(path));
}

/* True for requests that expect a JSON body rather than an HTML redirect. */
export function isApiPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  return path === "/api" || path.startsWith("/api/");
}
