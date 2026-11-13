import { isMagicLinkEmailType, isValidMagicLinkTokenHash } from "./confirm";

export function installedAppLoginPath(pathname: string): string {
  if (pathname.startsWith("/driver/")) return "/driver/login";
  if (pathname === "/warehouse" || pathname.startsWith("/warehouse/")) return "/warehouse/login";
  return "/login";
}

export function readPastedLoginLink(value: string, origin: string, providerUrl?: string) {
  try {
    const link = new URL(value.trim());
    if (link.username || link.password) return null;
    const tmsLink = link.origin === origin && ["/auth/confirm", "/api/auth/callback"].includes(link.pathname);
    const providerLink = providerUrl && link.origin === new URL(providerUrl).origin && link.pathname === "/auth/v1/verify";
    if (!tmsLink && !providerLink) return null;
    const tokenHash = link.searchParams.get(tmsLink ? "token_hash" : "token");
    const type = link.searchParams.get("type");
    if (!tokenHash || !isValidMagicLinkTokenHash(tokenHash) || !isMagicLinkEmailType(type)) return null;
    return { tokenHash, type };
  } catch {
    return null;
  }
}
