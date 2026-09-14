/*
  Invoice status rules (review ACC-3, ACC-4, INV-8).

  Values (lines, dates, references) are editable only while an invoice is a
  draft or awaiting POD and has never been posted to an accounting system.
  Once approved it is what gets synced to Xero, and once sent the customer
  holds a PDF, so changing values afterwards needs an explicit action: move an
  unsynced approved invoice back to draft, or void it and raise a credit note.

  The PATCH route may only make the manual transitions below. "sent" is set by
  the email route, "paid" and "credited" by payment and credit allocations.
*/

export const INVOICE_VALUE_EDITABLE_STATUSES = ["draft", "awaiting_pod"] as const;

/** Statuses a credit note may be raised or approved against. Mirrored in docs/sql/prodfix_42. */
export const CREDITABLE_INVOICE_STATUSES = [
  "approved",
  "sent",
  "part_paid",
  "partially_paid",
  "paid",
  "overdue",
] as const;

type Tier = "super_admin" | "admin" | "staff";

type Rule = { to: string; adminOnly?: boolean; requiresUnsynced?: boolean; requiresNoMoney?: boolean };

const VOID_RULE: Rule = { to: "void", adminOnly: true, requiresUnsynced: true, requiresNoMoney: true };

const MANUAL_TRANSITIONS: Record<string, Rule[]> = {
  draft: [{ to: "approved" }, VOID_RULE],
  awaiting_pod: [{ to: "draft" }, { to: "approved" }, VOID_RULE],
  approved: [{ to: "draft", requiresUnsynced: true }, VOID_RULE],
  sent: [VOID_RULE],
};

export type InvoiceLockState = {
  status: string | null | undefined;
  accountingInvoiceId: string | null | undefined;
};

export type RuleResult = { ok: true } | { ok: false; status: number; code: string; message: string };

function norm(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

export function canEditInvoiceValues(state: InvoiceLockState): RuleResult {
  if (state.accountingInvoiceId) {
    return {
      ok: false,
      status: 409,
      code: "invoice_synced",
      message:
        "This invoice has been posted to the accounting system. Void it and raise a credit note instead of editing it.",
    };
  }
  if (!(INVOICE_VALUE_EDITABLE_STATUSES as readonly string[]).includes(norm(state.status))) {
    return {
      ok: false,
      status: 409,
      code: "invoice_locked",
      message:
        "Only draft invoices can be edited. Move an approved invoice back to draft first, or void a sent invoice and raise a credit note.",
    };
  }
  return { ok: true };
}

export function checkInvoiceTransition(input: {
  from: string | null | undefined;
  to: string;
  tier: Tier;
  accountingInvoiceId: string | null | undefined;
  amountPaid: number;
  creditTotal: number;
}): RuleResult {
  const from = norm(input.from);
  const to = norm(input.to);

  if (from === to) {
    return { ok: false, status: 409, code: "status_unchanged", message: `The invoice is already ${to}.` };
  }

  const rule = (MANUAL_TRANSITIONS[from] ?? []).find((candidate) => candidate.to === to);
  if (!rule) {
    return {
      ok: false,
      status: 409,
      code: "invalid_transition",
      message: `An invoice cannot be moved from ${from || "unknown"} to ${to} here.`,
    };
  }

  if (rule.adminOnly && input.tier === "staff") {
    return { ok: false, status: 403, code: "admin_required", message: "Only an admin can void an invoice." };
  }

  if (rule.requiresUnsynced && input.accountingInvoiceId) {
    return {
      ok: false,
      status: 409,
      code: "invoice_synced",
      message:
        "This invoice has been posted to the accounting system, so it must be corrected there with a credit note.",
    };
  }

  if (rule.requiresNoMoney && (input.amountPaid > 0 || input.creditTotal > 0)) {
    return {
      ok: false,
      status: 409,
      code: "invoice_has_allocations",
      message: "This invoice has payments or credits allocated, so it cannot be voided.",
    };
  }

  return { ok: true };
}

export function isCreditableInvoiceStatus(status: string | null | undefined): boolean {
  return (CREDITABLE_INVOICE_STATUSES as readonly string[]).includes(norm(status));
}
