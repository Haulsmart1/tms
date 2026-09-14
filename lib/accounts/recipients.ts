/*
  Who a document email may go to (review ACC-5, audit M1).

  Invoices and quotations are sent from the platform's shared Microsoft 365
  sender, so a free-text recipient turns the route into a relay on the platform
  domain. A recipient must be an address already stored for that customer (the
  customer record or one of its contacts) or the signed-in caller's own address.
  New addresses are added to the customer record first, which leaves a trail.
*/

const EMAIL_PATTERN = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

/** Lower-cased address, or null when it is not a single plain address. CR/LF is always rejected. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\r\n]/.test(value)) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

export type RecipientResult =
  | { ok: true; recipient: string }
  | { ok: false; status: number; code: string; message: string };

export function resolveDocumentRecipient(input: {
  requested: unknown;
  /** Stored addresses in preference order, used when nothing is requested. */
  defaults: readonly unknown[];
  /** Every stored address for the customer, including contacts. */
  allowed: readonly unknown[];
  callerEmail: unknown;
}): RecipientResult {
  const allowed = new Set<string>();
  for (const value of input.allowed) {
    const email = normalizeEmail(value);
    if (email) allowed.add(email);
  }
  const caller = normalizeEmail(input.callerEmail);
  if (caller) allowed.add(caller);

  const requestedRaw = typeof input.requested === "string" ? input.requested : "";
  if (requestedRaw.trim()) {
    const requested = normalizeEmail(requestedRaw);
    if (!requested) {
      return { ok: false, status: 400, code: "invalid_recipient", message: "Enter a single valid email address." };
    }
    if (!allowed.has(requested)) {
      return {
        ok: false,
        status: 400,
        code: "recipient_not_on_file",
        message:
          "Documents can only be emailed to an address saved on the customer record or its contacts. Add the address to the customer first.",
      };
    }
    return { ok: true, recipient: requested };
  }

  for (const value of input.defaults) {
    const email = normalizeEmail(value);
    if (email && allowed.has(email)) return { ok: true, recipient: email };
  }

  return {
    ok: false,
    status: 400,
    code: "no_recipient",
    message: "This customer has no email address on file. Add one to the customer record first.",
  };
}
