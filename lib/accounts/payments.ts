/*
  Input validation for recording a customer payment (review ACC-1, INV-3, INV-10).

  This is the shape check only. Tenant and customer ownership of the invoice,
  currency agreement and the outstanding-balance cap are enforced atomically
  inside public.accounts_record_customer_payment (docs/sql/prodfix_40).
*/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 100_000_000;

export type PaymentInput = {
  customerId: string;
  amount: number;
  currency: string | null;
  paymentDate: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  bankReference: string | null;
  notes: string | null;
  invoiceId: string | null;
  allocateAmount: number | null;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/[\x00-\x1f\x7f]/g, " ").trim();
  return result ? result.slice(0, max) : null;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return roundMoney(parsed);
}

export function parsePaymentInput(body: Record<string, unknown>, today: string): ParseResult<PaymentInput> {
  const customerId = String(body.customerId ?? "").trim();
  if (!UUID_RE.test(customerId)) return { ok: false, message: "Choose a customer." };

  const amount = money(body.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { ok: false, message: "Enter a payment amount greater than zero." };
  }

  let currency: string | null = null;
  if (body.currency !== undefined && body.currency !== null && body.currency !== "") {
    currency = String(body.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Currency must be a three-letter code." };
  }

  const paymentDate = body.paymentDate ? String(body.paymentDate).trim() : today;
  if (!isIsoDate(paymentDate)) return { ok: false, message: "Payment date must be a valid date." };

  const rawInvoiceId = body.invoiceId ? String(body.invoiceId).trim() : "";
  let invoiceId: string | null = null;
  let allocateAmount: number | null = null;

  if (rawInvoiceId) {
    if (!UUID_RE.test(rawInvoiceId)) return { ok: false, message: "Invoice not found." };
    invoiceId = rawInvoiceId;
    const requested = money(body.allocateAmount);
    allocateAmount = requested === null ? amount : requested;
    if (Number.isNaN(allocateAmount) || allocateAmount <= 0) {
      return { ok: false, message: "The allocated amount must be greater than zero." };
    }
    if (allocateAmount > amount) {
      return { ok: false, message: "The allocated amount cannot exceed the payment amount." };
    }
  }

  return {
    ok: true,
    value: {
      customerId,
      amount,
      currency,
      paymentDate,
      paymentMethod: text(body.paymentMethod, 50),
      paymentReference: text(body.paymentReference, 200),
      bankReference: text(body.bankReference, 200),
      notes: text(body.notes, 2000),
      invoiceId,
      allocateAmount,
    },
  };
}
