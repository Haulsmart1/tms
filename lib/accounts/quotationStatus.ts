/*
  Quotation status rules for the member-facing PATCH route (review ACC-22, INV-4).

  "accepted" is only ever set by the customer acceptance flow (the public share
  link and its RPC), which records who accepted and when. Accepted, declined,
  expired, cancelled and converted are terminal here: reverting an accepted
  quotation to draft would let its prices change underneath the acceptance.
*/

export const QUOTATION_CONTENT_EDITABLE_STATUSES = ["draft", "sent"] as const;

const MANUAL_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["sent", "cancelled"],
  sent: ["declined", "expired", "cancelled"],
};

export type QuotationRuleResult = { ok: true } | { ok: false; status: number; code: string; message: string };

function norm(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

export function checkQuotationTransition(fromRaw: string | null | undefined, toRaw: string): QuotationRuleResult {
  const from = norm(fromRaw);
  const to = norm(toRaw);

  if (to === "accepted" && from !== "accepted") {
    return {
      ok: false,
      status: 409,
      code: "acceptance_requires_customer",
      message: "A quotation can only be accepted by the customer through the acceptance link.",
    };
  }

  if (from === to) {
    return { ok: true };
  }

  if (!(MANUAL_TRANSITIONS[from] ?? []).includes(to)) {
    return {
      ok: false,
      status: 409,
      code: "invalid_transition",
      message: `A quotation cannot be moved from ${from || "unknown"} to ${to}.`,
    };
  }

  return { ok: true };
}

export function canEditQuotationContent(status: string | null | undefined): QuotationRuleResult {
  if ((QUOTATION_CONTENT_EDITABLE_STATUSES as readonly string[]).includes(norm(status))) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 409,
    code: "quotation_locked",
    message: "Only draft or sent quotations can be edited.",
  };
}
