/*
  Absolute links placed in customer emails and share responses (review ACC-21,
  INV-26). Built from the configured NEXT_PUBLIC_SITE_URL (already used by the
  invite routes), never from the request Host, so a preview deployment or a
  spoofed Host header cannot put a foreign origin into a customer's inbox.
  The request origin is used only outside production, for localhost.
*/

export const DEFAULT_PUBLIC_ORIGIN = "https://tmswizard.cloud";

type Env = { NEXT_PUBLIC_SITE_URL?: string; NODE_ENV?: string };

function httpOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function publicAppOrigin(requestUrl?: string | null, env: Env = process.env as Env): string {
  const configured = httpOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;
  if (env.NODE_ENV !== "production") {
    const fromRequest = httpOrigin(requestUrl);
    if (fromRequest) return fromRequest;
  }
  return DEFAULT_PUBLIC_ORIGIN;
}
