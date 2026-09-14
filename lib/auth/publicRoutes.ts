/* The allowlist behind the edge auth gate in proxy.ts (Next 16's name for
   middleware.ts). Deny by default: anything not matched here requires a
   signed-in user.

   Kept in lib/ rather than inline in proxy.ts for two reasons: vitest only
   collects lib/**\/*.test.ts (see vitest.config.ts), and this file must stay free
   of next/server imports so the tests run without an edge runtime.

   Every entry is as narrow as the route it serves. There are deliberately no
   prefix entries: a prefix quietly makes every FUTURE route beneath it public,
   which is how a staff-only endpoint ends up reachable anonymously.
   lib/auth/routeClassification.test.ts walks app/ on disk and fails when a
   route file is not classified on purpose, so a new route cannot silently 401
   (or silently open). */

/* Paths that are public and have no sub-paths. Matched exactly. */
const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  /* Scanner-safe confirmation page for emailed sign-in links. It performs no
     verification on GET; the human presses Continue, which POSTs below. */
  "/auth/confirm",
  /* Runs before a session exists: this is the route that creates one. */
  "/api/auth/callback",
  /* Sends the sign-in email. Rate limited per email and per IP, never creates
     an account, and answers identically whether or not the address exists. */
  "/api/auth/magic-link",
  /* Lead intake from the landing page form. Rate limited durably inside the
     route; it cannot require a session because the sender has no account. */
  "/api/request-access",
  /* Bearer-secret auth (CAMBRIDGE_RMA_SECRET), checked inside the route
     handler with a constant-time compare. A machine caller has no cookie. */
  "/api/integrations/cambridge-audio/rma",
  /* Vercel cron (see vercel.json). Authenticated by CRON_SECRET in an
     authorization header, and arrives with no session cookie at all, so the
     gate has to let it reach the handler that checks that secret. */
  "/api/billing/run",
]);

/* Public paths that need a shape. One dynamic segment ([^/]+) per token, and
   nothing may follow it unless spelled out.

   /api/pod/share is deliberately only matched in its /[token]/pdf form. Its
   siblings /api/pod/share (POST, mints a share token) and /api/pod/share/email
   are staff-only; a prefix allowlist here would let an anonymous caller mint
   POD share tokens for any job. */
const PUBLIC_PATTERNS = [
  /* Token-gated customer links. POD share tokens are random, stored hashed in
     pod_share_links and re-checked on every view (lib/pod/shareLinks.ts); the
     token is the credential, a session would defeat the point of sharing. */
  /^\/pod\/share\/[^/]+$/,
  /^\/api\/pod\/share\/[^/]+\/pdf$/,
  /^\/quotation\/share\/[^/]+$/,
  /* Token-gated public quotation accept/decline and quote-request intake.
     Each route checks its token against the database itself. */
  /^\/api\/public\/quotation-share\/[^/]+$/,
  /^\/api\/public\/quote-request\/[^/]+$/,
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

  return PUBLIC_PATTERNS.some((pattern) => pattern.test(path));
}

/* True for requests that expect a JSON body rather than an HTML redirect. */
export function isApiPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  return path === "/api" || path.startsWith("/api/");
}
