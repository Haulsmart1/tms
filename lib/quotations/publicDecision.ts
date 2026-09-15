/*
  Validation for the anonymous accept/decline/view endpoint (INV-19).

  The body comes from anyone holding a share link, so nothing about its shape
  is trusted: a null or array body, non-string fields, oversized strings and
  unbounded clause arrays are all rejected with a fixed message instead of
  throwing a TypeError that became a 500 with the raw message.
*/

import { isIP } from "node:net";

export const DECISION_LIMITS = {
  name: 150,
  email: 254,
  companyName: 200,
  position: 150,
  clauseKey: 100,
  clauseKeys: 200,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SNAPSHOT_HASH_PATTERN = /^[0-9a-f]{64}$/;

export const INVALID_REQUEST = "Invalid request.";
export const STALE_PAGE = "This page is out of date. Please reload the quotation and try again.";

export type QuotationDecision =
  | {
      action: "accept";
      name: string;
      email: string;
      companyName: string;
      position: string;
      clauseKeys: string[];
      adrAccepted: boolean;
      snapshotHash: string;
    }
  | { action: "decline"; name: string; email: string }
  | { action: "view" };

type Result = { ok: true; value: QuotationDecision } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for C0 control characters (code points 0 to 31) and DEL (127). */
function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

/** undefined/null -> "", string -> trimmed, anything else -> null (invalid). */
function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  return value.trim();
}

function checkField(value: string | null, label: string, max: number, required: boolean): string | null {
  if (value === null) return INVALID_REQUEST;
  if (required && !value) return `${label} is required.`;
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  if (hasControlCharacters(value)) return `${label} contains characters that are not allowed.`;
  return null;
}

export function parseQuotationDecision(body: unknown): Result {
  if (!isPlainObject(body)) return { ok: false, error: INVALID_REQUEST };

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  if (action === "view") return { ok: true, value: { action: "view" } };
  if (action !== "accept" && action !== "decline") return { ok: false, error: "Invalid quotation action." };

  const name = readString(body, "name");
  const email = readString(body, "email");

  const nameError = checkField(name, "Your name", DECISION_LIMITS.name, true);
  if (nameError) return { ok: false, error: nameError };

  const emailError = checkField(email, "Your email address", DECISION_LIMITS.email, true);
  if (emailError) return { ok: false, error: emailError };
  if (!EMAIL_PATTERN.test(email as string)) return { ok: false, error: "Enter a valid email address." };

  if (action === "decline") {
    return { ok: true, value: { action: "decline", name: name as string, email: email as string } };
  }

  const companyName = readString(body, "companyName");
  const companyError = checkField(companyName, "Company name", DECISION_LIMITS.companyName, true);
  if (companyError) return { ok: false, error: companyError };

  const position = readString(body, "position");
  const positionError = checkField(position, "Position", DECISION_LIMITS.position, true);
  if (positionError) return { ok: false, error: positionError };

  const rawKeys = body.clauseKeys ?? [];
  if (!Array.isArray(rawKeys) || rawKeys.length > DECISION_LIMITS.clauseKeys) {
    return { ok: false, error: INVALID_REQUEST };
  }

  const clauseKeys = new Set<string>();
  for (const key of rawKeys) {
    if (typeof key !== "string") return { ok: false, error: INVALID_REQUEST };
    const trimmed = key.trim();
    if (!trimmed) continue;
    if (trimmed.length > DECISION_LIMITS.clauseKey) return { ok: false, error: INVALID_REQUEST };
    clauseKeys.add(trimmed);
  }

  if (body.adrAccepted !== undefined && typeof body.adrAccepted !== "boolean") {
    return { ok: false, error: INVALID_REQUEST };
  }

  const snapshotHash = typeof body.snapshotHash === "string" ? body.snapshotHash.trim().toLowerCase() : "";
  if (!SNAPSHOT_HASH_PATTERN.test(snapshotHash)) return { ok: false, error: STALE_PAGE };

  return {
    ok: true,
    value: {
      action: "accept",
      name: name as string,
      email: email as string,
      companyName: companyName as string,
      position: position as string,
      clauseKeys: Array.from(clauseKeys),
      adrAccepted: body.adrAccepted === true,
      snapshotHash,
    },
  };
}

/**
  The client IP stored as acceptance evidence. On Vercel x-real-ip is set by
  the platform; the first x-forwarded-for hop is client-supplied, so it is
  only a fallback. Returns null unless the value is a real IP address, which
  also keeps the RPC's inet cast from failing.
*/
export function evidenceIp(headers: { get(name: string): string | null }): string | null {
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value;
  }

  return null;
}
