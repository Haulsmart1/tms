/*
  Who a POD email may go to (review POD-3, M1).

  The route used to send to any address the caller typed, with tenant-written
  content (references, customer names, notes) through the platform's mail
  sender: an open relay for phishing. A POD now goes only to an address stored
  on that job's customer record, or to the signed-in caller's own address.
*/

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || /[\r\n]/.test(trimmed)) return null;
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

/** A stored customer field may hold several addresses separated by , or ; */
export function splitStoredEmails(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[;,]/)
    .map((part) => normalizeEmail(part))
    .filter((part): part is string => part !== null);
}

export type RecipientCheck =
  | { ok: true; recipient: string }
  | { ok: false; status: 400 | 403; message: string };

export function checkPodRecipient(input: {
  requested: unknown;
  customerEmailFields: ReadonlyArray<unknown>;
  callerEmail: unknown;
}): RecipientCheck {
  const requested = normalizeEmail(input.requested);
  if (!requested) {
    return { ok: false, status: 400, message: "A valid POD email recipient is required." };
  }

  const allowed = new Set<string>(input.customerEmailFields.flatMap((field) => splitStoredEmails(field)));
  const caller = normalizeEmail(input.callerEmail);
  if (caller) allowed.add(caller);

  if (!allowed.has(requested)) {
    return {
      ok: false,
      status: 403,
      message:
        "A POD can only be emailed to an address saved on this job's customer, or to your own email address. Add the address to the customer first.",
    };
  }

  return { ok: true, recipient: requested };
}
