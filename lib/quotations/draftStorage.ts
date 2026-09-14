/*
  Expiring quotation drafts in localStorage (INV-23).

  A draft can hold a prospect's name, phone, email and addresses copied from a
  public quote request, and localStorage survives sign-out on a shared depot
  PC. Drafts are therefore wrapped with the time they were saved and thrown
  away after QUOTATION_DRAFT_TTL_MS. Drafts written before this envelope
  existed have no timestamp, so their age is unknown and they are discarded.
*/

export const QUOTATION_DRAFT_PREFIX = "tms:quotation-draft:";
export const QUOTATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/* A savedAt further in the future than this is treated as tampered or a
   broken clock, otherwise the draft would never expire. */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
const ENVELOPE_VERSION = 1;

type Envelope = {
  version: number;
  savedAt: string;
  draft: Record<string, unknown>;
};

export function quotationDraftKey(tenantId: string): string {
  return `${QUOTATION_DRAFT_PREFIX}${tenantId}`;
}

export function serialiseQuotationDraft(draft: Record<string, unknown>, now: Date = new Date()): string {
  const envelope: Envelope = {
    version: ENVELOPE_VERSION,
    savedAt: now.toISOString(),
    draft,
  };

  return JSON.stringify(envelope);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The stored draft if it is well-formed and unexpired, otherwise null. */
export function parseQuotationDraft(raw: string | null, now: Date = new Date()): Record<string, unknown> | null {
  if (!raw) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || parsed.version !== ENVELOPE_VERSION || typeof parsed.savedAt !== "string") {
    return null;
  }

  if (!isPlainObject(parsed.draft)) return null;

  const savedAt = Date.parse(parsed.savedAt);
  if (!Number.isFinite(savedAt)) return null;

  const age = now.getTime() - savedAt;
  if (age > QUOTATION_DRAFT_TTL_MS || age < -MAX_CLOCK_SKEW_MS) return null;

  return parsed.draft;
}

/** Keys of every stored quotation draft (any tenant) that is expired or unreadable. */
export function staleQuotationDraftKeys(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  now: Date = new Date()
): string[] {
  const stale: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key && key.startsWith(QUOTATION_DRAFT_PREFIX) && parseQuotationDraft(storage.getItem(key), now) === null) {
      stale.push(key);
    }
  }

  return stale;
}
