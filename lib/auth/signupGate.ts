/* Kill switch for self-serve signup.

   /signup and POST /api/signup are public routes (lib/auth/publicRoutes.ts)
   and the route creates a company on the service role, so anyone who finds
   the URL can open an account. Until the launch blockers in README.md are
   cleared (solicitor review, recorded terms acceptance, custom SMTP, the
   signup_01 SQL) that must not be possible in production.

   The switch fails CLOSED. Only the literal "true" in SIGNUP_ENABLED opens
   signup; unset, blank, "1", "yes" or a typo all keep it shut, so a missing
   Vercel variable can never open the doors by accident. It is a server-only
   variable, deliberately without the NEXT_PUBLIC_ prefix: the page reads it
   in a server component and the route reads it on every request, and the
   browser never learns which way it is set. */

export const SIGNUP_ENABLED_ENV = "SIGNUP_ENABLED";

export function signupEnabled(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/* What the route answers while closed. 404 rather than 403 or 503: the
   route looks like it does not exist, which says nothing about accounts,
   pricing or launch timing. The shape matches the other signup responses
   in lib/auth/signup.ts so the form's error path handles it unchanged. */
export function signupClosedResponse(): { status: number; body: { ok: false; error: "not_found" } } {
  return { status: 404, body: { ok: false, error: "not_found" } };
}
