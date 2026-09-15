/*
  Request checks for the public quote-request intake (INV-7, INV-22, INV-21).

  Pure and framework-free so vitest can cover it; the route wires these to
  the rate limiter and the token lookup.
*/

export const PUBLIC_TOKEN_MIN_LENGTH = 32;
export const PUBLIC_TOKEN_MAX_LENGTH = 512;

/* URL-safe and standard base64 alphabets plus a few unreserved characters.
   Anything else cannot be a token we issued. */
const TOKEN_CHARSET = /^[A-Za-z0-9_.~+/=-]+$/;

const HONEYPOT_FIELDS = ["_honey", "_gotcha"];

export const INTAKE_PREFLIGHT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

/** Decodes and bounds the token from the URL; null when it cannot be valid. */
export function readPublicToken(raw: unknown): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(String(raw ?? ""));
  } catch {
    return null;
  }

  const token = decoded.trim();

  if (
    token.length < PUBLIC_TOKEN_MIN_LENGTH ||
    token.length > PUBLIC_TOKEN_MAX_LENGTH ||
    !TOKEN_CHARSET.test(token)
  ) {
    return null;
  }

  return token;
}

function toOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The caller's origin from Origin, falling back to the Referer's origin. */
export function requestOriginFromHeaders(headers: { get(name: string): string | null }): string | null {
  return toOrigin(headers.get("origin")) ?? toOrigin(headers.get("referer"));
}

/**
  When the token has an allowed_origin, the request MUST prove it came from
  there: a missing Origin and Referer is refused, not waved through (INV-7).
  A token with no allowed_origin accepts any origin; the token and the rate
  limits are then the only gate. A malformed allowed_origin fails closed.
*/
export function isIntakeOriginAllowed(
  configuredOrigin: string | null | undefined,
  requestOrigin: string | null
): boolean {
  if (!configuredOrigin || !configuredOrigin.trim()) return true;

  const configured = toOrigin(configuredOrigin);
  if (!configured) return false;

  return requestOrigin !== null && requestOrigin === configured;
}

/**
  CORS response headers (INV-22). Access-Control-Allow-Origin is only sent
  for the token's configured origin, so a browser form on that site can read
  the response instead of reporting a network error and being resubmitted.
*/
export function intakeCorsHeaders(
  configuredOrigin: string | null | undefined,
  originHeader: string | null
): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const configured = configuredOrigin ? toOrigin(configuredOrigin) : null;

  if (configured && toOrigin(originHeader) === configured) {
    headers["Access-Control-Allow-Origin"] = configured;
  }

  return headers;
}

/** True when a bot filled a hidden honeypot field. */
export function isHoneypotFilled(payload: Record<string, unknown>): boolean {
  return HONEYPOT_FIELDS.some((field) => {
    const value = payload[field];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}
