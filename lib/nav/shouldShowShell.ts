import type { TenantStatus } from "../tenant/context";

// Two independent checks, both required — this is the fix for 91fa6b0 ("Hide the
// app header on the login page"). Before that commit, only a pathname check
// existed and /login wasn't in it, so a signed-out visitor on /login saw the
// full internal nav. The status check is the fail-closed backstop: using
// `status !== "ready"` (rather than enumerating "loading"/"signed-out") means
// any future status value defaults to hidden too, not just the two known today.
export function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  return status === "ready";
}
