/*
  Customer webhook_url validation (review ACC-23).

  No sender exists yet, so this is the storage-time half: https only, no
  credentials in the URL, and no loopback, private, link-local, CGNAT or
  metadata hosts, including IPv4-mapped IPv6 and internal-looking names. The
  future sender must still resolve the name and re-check the address it
  connects to, because a public name can point at a private IP.
*/

export type WebhookUrlResult = { ok: true; value: string | null } | { ok: false; message: string };

const MAX_LENGTH = 2048;

function isBlockedIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isIpv6Literal(host: string): boolean {
  return host.startsWith("[") && host.endsWith("]");
}

function isBlockedIpv6(host: string): boolean {
  const addr = host.slice(1, -1).toLowerCase();
  return (
    addr === "::" ||
    addr === "::1" ||
    addr.startsWith("::ffff:") ||
    /^f[cd]/.test(addr) ||
    /^fe[89ab]/.test(addr) ||
    addr.startsWith("ff")
  );
}

export function validateWebhookUrl(raw: unknown): WebhookUrlResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Webhook URL must be text." };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MAX_LENGTH || /\s/.test(trimmed)) return { ok: false, message: "Webhook URL is not valid." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "Webhook URL is not valid." };
  }

  if (url.protocol !== "https:") return { ok: false, message: "Webhook URL must use https." };
  if (url.username || url.password) return { ok: false, message: "Webhook URL must not contain credentials." };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const ipv6 = isIpv6Literal(host);
  const blocked =
    !host ||
    (ipv6 ? isBlockedIpv6(host) : false) ||
    (!ipv6 &&
      (host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.endsWith(".home.arpa") ||
        !host.includes(".") ||
        isBlockedIpv4(host)));

  if (blocked) {
    return { ok: false, message: "Webhook URL must point at a public internet host." };
  }

  return { ok: true, value: url.toString() };
}
