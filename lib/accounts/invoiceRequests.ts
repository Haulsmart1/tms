/*
  Request parsing for invoice create and edit (review ACC-3, ACC-9, INV-8, INV-9).

  Everything is validated here before the route touches the database, so a bad
  line can no longer leave a half-applied header behind, and an invalid date
  answers 400 instead of throwing RangeError.
*/

import { isIsoDate } from "./payments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JOBS = 500;
const MAX_LINES = 500;

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > max) return { ok: false };
  return { ok: true, value: trimmed || null };
}

export type CreateInvoiceRequest = {
  customerId: string;
  jobIds: string[];
  issueDate: string;
  dueDate: string | null;
  poReference: string | null;
  notes: string | null;
};

export function parseCreateInvoice(body: Record<string, unknown>, today: string): Parsed<CreateInvoiceRequest> {
  if (body.invoiceNumber !== undefined && body.invoiceNumber !== null && body.invoiceNumber !== "") {
    return fail("invoice_number_not_allowed", "Invoice numbers are allocated automatically.");
  }

  const customerId = String(body.customerId ?? "").trim();
  if (!UUID_RE.test(customerId)) return fail("invalid_customer", "Choose a customer.");

  if (!Array.isArray(body.jobIds) || body.jobIds.length === 0) {
    return fail("no_jobs", "Select at least one job.");
  }
  const jobIds = Array.from(new Set(body.jobIds.map((id) => String(id ?? "").trim())));
  if (jobIds.length > MAX_JOBS) return fail("too_many_jobs", `An invoice can cover at most ${MAX_JOBS} jobs.`);
  if (jobIds.some((id) => !UUID_RE.test(id))) return fail("jobs_not_found", "One or more selected jobs were not found.");

  const issueDate = body.issueDate ? String(body.issueDate).trim() : today;
  if (!isIsoDate(issueDate)) return fail("invalid_date", "Issue date must be a valid date.");

  const dueDate = body.dueDate ? String(body.dueDate).trim() : null;
  if (dueDate !== null && !isIsoDate(dueDate)) return fail("invalid_date", "Due date must be a valid date.");
  if (dueDate !== null && dueDate < issueDate) return fail("invalid_date", "Due date cannot be before the issue date.");

  const poReference = optionalText(body.poReference, 200);
  const notes = optionalText(body.notes, 4000);
  if (!poReference.ok || !notes.ok) return fail("invalid_text", "PO reference or notes are not valid.");

  return {
    ok: true,
    value: { customerId, jobIds, issueDate, dueDate, poReference: poReference.value, notes: notes.value },
  };
}

export const INVOICE_HEADER_FIELDS = ["issue_date", "due_date", "po_reference", "customer_reference", "notes"] as const;

/** Written only by server actions (sync, email, allocations, numbering), never by PATCH. */
export const INVOICE_SERVER_ONLY_FIELDS = [
  "accounting_provider",
  "accounting_invoice_id",
  "accounting_sync_status",
  "accounting_sync_error",
  "accounting_synced_at",
  "invoice_email",
  "approved_by",
  "approved_at",
  "sent_by",
  "sent_at",
  "invoice_number",
  "customer_id",
  "tenant_id",
  "subtotal",
  "vat_total",
  "total",
  "amount_paid",
  "credit_total",
  "balance_due",
  "currency",
] as const;

export type InvoiceLineEdit = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
};

export type InvoicePatchRequest =
  | { kind: "status"; status: string }
  | { kind: "values"; header: Record<string, string | null>; lines: InvoiceLineEdit[] | null };

function finite(value: unknown): number {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return typeof value === "number" ? value : Number(value);
}

export function parseInvoicePatch(body: Record<string, unknown>): Parsed<InvoicePatchRequest> {
  for (const field of INVOICE_SERVER_ONLY_FIELDS) {
    if (body[field] !== undefined) {
      return fail("field_not_editable", `${field} cannot be changed here.`);
    }
  }

  const headerKeys = INVOICE_HEADER_FIELDS.filter((field) => body[field] !== undefined);
  const hasLines = body.lines !== undefined;

  if (body.status !== undefined) {
    if (headerKeys.length > 0 || hasLines) {
      return fail("mixed_update", "Change the invoice status separately from other edits.");
    }
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!status) return fail("invalid_status", "Invalid invoice status.");
    return { ok: true, value: { kind: "status", status } };
  }

  if (headerKeys.length === 0 && !hasLines) {
    return fail("no_changes", "No invoice changes were supplied.");
  }

  const header: Record<string, string | null> = {};

  if (body.issue_date !== undefined) {
    const value = body.issue_date ? String(body.issue_date).trim() : "";
    if (!isIsoDate(value)) return fail("invalid_date", "Issue date must be a valid date.");
    header.issue_date = value;
  }

  if (body.due_date !== undefined) {
    const value = body.due_date ? String(body.due_date).trim() : "";
    if (value && !isIsoDate(value)) return fail("invalid_date", "Due date must be a valid date.");
    header.due_date = value || null;
  }

  if (header.issue_date && header.due_date && header.due_date < header.issue_date) {
    return fail("invalid_date", "Due date cannot be before the issue date.");
  }

  for (const [field, max] of [
    ["po_reference", 200],
    ["customer_reference", 200],
    ["notes", 4000],
  ] as const) {
    if (body[field] === undefined) continue;
    const parsed = optionalText(body[field], max);
    if (!parsed.ok) return fail("invalid_text", `${field} is not valid.`);
    header[field] = parsed.value;
  }

  let lines: InvoiceLineEdit[] | null = null;

  if (hasLines) {
    if (!Array.isArray(body.lines)) return fail("invalid_lines", "Invoice lines must be a list.");
    if (body.lines.length > MAX_LINES) return fail("invalid_lines", "Too many invoice lines.");

    const seen = new Set<string>();
    lines = [];

    for (const raw of body.lines) {
      if (!raw || typeof raw !== "object") return fail("invalid_lines", "Invalid invoice line values.");
      const line = raw as Record<string, unknown>;
      const id = String(line.id ?? "").trim();
      const quantity = finite(line.quantity);
      const unitPrice = finite(line.unit_price);
      const vatRate = finite(line.vat_rate);
      const description = line.description === undefined || line.description === null ? "" : line.description;

      if (
        !UUID_RE.test(id) ||
        seen.has(id) ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 1_000_000 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0 ||
        unitPrice > 1_000_000_000 ||
        !Number.isFinite(vatRate) ||
        vatRate < 0 ||
        vatRate > 100 ||
        typeof description !== "string" ||
        description.length > 1000
      ) {
        return fail("invalid_lines", "Invalid invoice line values.");
      }

      seen.add(id);
      lines.push({
        id,
        description: description.trim() || "Transport service",
        quantity,
        unit_price: unitPrice,
        vat_rate: vatRate,
      });
    }
  }

  return { ok: true, value: { kind: "values", header, lines } };
}
