import type { TenantStatus } from "../tenant/context";

// Two independent checks, both required. The pathname exemption alone was
// the gap commit 91fa6b0 closed: /login was missing from it, so an
// ALREADY-SIGNED-IN user saw a stray Dashboard link on the sign-in page
// (cosmetic, not an auth bypass — signed-out visitors were already blocked
// by the status check below). The status check is the fail-closed backstop
// regardless: using `status === "ready"` (an allowlist of the one good
// value, not a denylist of bad ones) means any future status value not yet
// accounted for defaults to hidden too.
export function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  return status === "ready";
}
