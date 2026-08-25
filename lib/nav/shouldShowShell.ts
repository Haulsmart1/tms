import type { TenantStatus } from "../tenant/context";
import { isSkeletonReadyRoute } from "./skeletonReadyRoutes";

// Two independent checks, both required. The pathname exemption alone was
// the gap commit 91fa6b0 closed: /login was missing from it, so an
// ALREADY-SIGNED-IN user saw a stray Dashboard link on the sign-in page
// (cosmetic, not an auth bypass — signed-out visitors were already blocked
// by the status check below). The status check is the fail-closed backstop
// regardless: it is an allowlist of the good (status, route) combinations,
// not a denylist of bad ones, so any future status value not yet accounted
// for defaults to hidden too.
export function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  if (status === "ready") return true;
  // A skeleton-ready route draws its own loading state, so the shell renders
  // beside it rather than after it. Only "loading" is relaxed: "signed-out"
  // and "no-tenant" still hide the shell on every route, converted or not.
  return status === "loading" && isSkeletonReadyRoute(pathname);
}
