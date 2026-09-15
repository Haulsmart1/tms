export type AuthCallbackVerificationDecision =
  | "verified"
  | "recover-existing-session"
  | "reject";

export function decideAuthCallbackVerification(
  verificationFailed: boolean,
  hasAuthenticatedUser: boolean,
): AuthCallbackVerificationDecision {
  if (!verificationFailed) {
    return "verified";
  }

  if (hasAuthenticatedUser) {
    return "recover-existing-session";
  }

  return "reject";
}

export function authCallbackRedirectStatus(
  method: string,
): 303 | 307 {
  return method.toUpperCase() === "POST"
    ? 303
    : 307;
}

/* Paths that belong to a portal rather than the operator console. */
export function isPortalPath(path: string): boolean {
  return /^\/(driver|subcontractor)(\/|$|\?|#)/.test(path);
}

export type PortalLookup =
  | { ok: true; destination: string | null }
  | { ok: false };

/* Where a freshly signed-in user lands (AUTH-5 callback half, AUTH-14).

   A driver_users or subcontractor_users link used to override `next` for
   EVERY login, so a staff or admin user of one company who was attached as a
   driver by another company was sent to that company's portal on every
   sign-in. The portal now wins only when the user has no console profile, or
   when they explicitly asked for a portal page.

   A failed lookup is not guessed around: it used to fall through to the
   console, which dropped drivers on a no-tenant panel with no hint. */
export function decidePostLoginDestination(input: {
  requestedNext: string;
  portal: PortalLookup;
  hasConsoleProfile: boolean | "unknown";
}): string {
  const { requestedNext, portal, hasConsoleProfile } = input;

  if (!portal.ok) return "/login?error=portal";
  if (isPortalPath(requestedNext)) return requestedNext;
  if (!portal.destination) return requestedNext;
  if (hasConsoleProfile === "unknown") return "/login?error=portal";
  return hasConsoleProfile ? requestedNext : portal.destination;
}

/* What the legacy GET callback does with its query string (AUTH-6).

   It no longer verifies a token_hash itself. A GET that verifies is a login
   CSRF (a cross-site link signs the clicker in as whoever minted the token)
   and lets mail scanners burn single-use invite links. A token_hash on GET is
   forwarded to the scanner-safe confirm page instead, which needs a human to
   press Continue and then POSTs with an Origin check. A PKCE `code` is still
   exchanged on GET: it is bound to the verifier cookie in the browser that
   started the flow, so it cannot be replayed cross-site. */
export type LegacyCallbackAction =
  | { kind: "confirm"; location: string }
  | { kind: "exchange-code"; code: string }
  | { kind: "invalid" };

export function decideLegacyCallbackAction(params: URLSearchParams): LegacyCallbackAction {
  const tokenHash = params.get("token_hash");

  if (tokenHash !== null) {
    if (!tokenHash || tokenHash.length > 512 || /\s/.test(tokenHash)) {
      return { kind: "invalid" };
    }
    const confirm = new URLSearchParams();
    confirm.set("token_hash", tokenHash);
    confirm.set("type", params.get("type") ?? "email");
    const next = params.get("next");
    if (next) confirm.set("next", next);
    return { kind: "confirm", location: `/auth/confirm?${confirm.toString()}` };
  }

  const code = params.get("code");
  if (code && code.length <= 512 && !/\s/.test(code)) {
    return { kind: "exchange-code", code };
  }

  return { kind: "invalid" };
}
