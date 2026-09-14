/*
  Whether a shared quotation can still be accepted or declined (INV-6), and
  the only messages an anonymous visitor ever sees (INV-18).

  A share link used to stay acceptable after the operator cancelled, declined
  or expired the quotation, or after valid_until passed, because only the link
  row was checked. The same rule is enforced again inside the acceptance RPCs
  in docs/sql/prodfix_50_quotation_share_acceptance.sql.
*/

import { isValidYmd } from "../invoices/dates";

/* Statuses from which a customer may still accept or decline. */
const DECIDABLE_STATUSES = new Set(["draft", "sent"]);

export type ShareClosedReason = "cancelled" | "expired" | "unavailable";

export type ShareDecisionState =
  | { state: "open" }
  | { state: "accepted" }
  | { state: "declined" }
  | { state: "closed"; reason: ShareClosedReason };

export function quotationShareState(input: {
  quotationStatus: unknown;
  validUntil: unknown;
  convertedJobId?: unknown;
  shareAcceptedAt?: unknown;
  shareDeclinedAt?: unknown;
  /** The operator's calendar day, YYYY-MM-DD. */
  today: string;
}): ShareDecisionState {
  const status = String(input.quotationStatus ?? "").trim().toLowerCase();

  if (input.shareAcceptedAt || status === "accepted") return { state: "accepted" };
  if (input.shareDeclinedAt || status === "declined") return { state: "declined" };
  if (status === "cancelled") return { state: "closed", reason: "cancelled" };
  if (status === "expired") return { state: "closed", reason: "expired" };
  if (input.convertedJobId || !DECIDABLE_STATUSES.has(status)) return { state: "closed", reason: "unavailable" };

  if (isValidYmd(input.validUntil) && isValidYmd(input.today) && input.validUntil < input.today) {
    return { state: "closed", reason: "expired" };
  }

  return { state: "open" };
}

export const SHARE_MESSAGES = {
  invalid: "This quotation link is invalid or has expired.",
  revoked: "This quotation link has been revoked.",
  linkExpired: "This quotation link has expired.",
  cancelled: "This quotation has been withdrawn. Please contact the sender for an updated quotation.",
  expired: "This quotation has passed its validity date. Please contact the sender for an updated quotation.",
  unavailable: "This quotation is no longer available. Please contact the sender.",
  alreadyAccepted: "This quotation has already been accepted.",
  alreadyDeclined: "This quotation has already been declined.",
  changed: "This quotation has changed since you opened it. Please reload the page to review the latest version.",
  rateLimited: "Too many requests. Please wait a few minutes and try again.",
  generic: "We could not load this quotation. Please try again later or contact the sender.",
  genericDecision: "We could not record your response. Please try again later or contact the sender.",
} as const;

export type ShareMessageCode = keyof typeof SHARE_MESSAGES;

export class QuotationShareError extends Error {
  readonly code: ShareMessageCode;
  readonly status: number;

  constructor(code: ShareMessageCode, status: number) {
    super(SHARE_MESSAGES[code]);
    this.name = "QuotationShareError";
    this.code = code;
    this.status = status;
  }
}

export function closedReasonCode(reason: ShareClosedReason): ShareMessageCode {
  return reason;
}

/** A fixed, safe message for any error; internal detail never reaches the visitor. */
export function publicShareError(
  error: unknown,
  fallback: ShareMessageCode = "generic"
): { message: string; status: number } {
  if (error instanceof QuotationShareError) {
    return { message: error.message, status: error.status };
  }

  return { message: SHARE_MESSAGES[fallback], status: 500 };
}

/*
  Business messages raised by the acceptance RPCs that are safe and useful to
  show verbatim. Anything else (constraint names, column names, config errors)
  becomes the generic message.
*/
const SAFE_RPC_MESSAGES = new Set<string>([
  "Your name is required.",
  "Your email address is required.",
  "Company name is required.",
  "Position is required.",
  "This quotation link has been revoked.",
  "This quotation link has expired.",
  "This quotation has already been accepted.",
  "This quotation has already been declined.",
  "Every required Terms & Conditions clause must be acknowledged.",
  "ADR Dangerous Goods acceptance is required.",
  "Terms snapshot is missing from this quotation. Generate a new share link.",
  SHARE_MESSAGES.cancelled,
  SHARE_MESSAGES.expired,
  SHARE_MESSAGES.unavailable,
  SHARE_MESSAGES.changed,
]);

export function publicRpcErrorMessage(message: unknown): string {
  const text = typeof message === "string" ? message.trim() : "";
  return SAFE_RPC_MESSAGES.has(text) ? text : SHARE_MESSAGES.genericDecision;
}
