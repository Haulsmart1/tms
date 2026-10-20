/**
 * An auth-server outage is not evidence that a session is revoked.
 * Fail closed while giving the operator a retry path instead of
 * treating a 429/5xx as a genuine sign-out.
 *
 * 400/401/403 (invalid/expired credentials) are intentionally not transient.
 * This helper never inspects or modifies session tokens or stored evidence.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" &&
    (status === 429 || (status >= 500 && status <= 599));
}
