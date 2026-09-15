import { listPageInfo, parseListPage } from "../../../../lib/accounts/listPaging";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject, rpcFailure, type RpcMessages } from "../../../../lib/accounts/errors";
import { parsePaymentInput } from "../../../../lib/accounts/payments";
import { operatorDay } from "../../../../lib/time";

export const dynamic = "force-dynamic";

/*
  Recording a payment and allocating it to an invoice happens in one database
  transaction (docs/sql/prodfix_40), which checks that the invoice belongs to
  this tenant and customer, is payable, is in the same currency, and has enough
  outstanding balance (review ACC-1, INV-3, INV-10).
*/
const PAYMENT_MESSAGES: RpcMessages = {
  payment_invalid: [400, "The payment details are not valid."],
  payment_amount_invalid: [400, "Enter a payment amount greater than zero."],
  customer_not_found: [404, "Customer not found."],
  invoice_not_found: [404, "Invoice not found for this customer."],
  invoice_not_payable: [409, "Payments can only be allocated to an approved or sent invoice."],
  currency_mismatch: [409, "The payment currency does not match the invoice currency."],
  allocation_invalid: [400, "The allocated amount must be greater than zero and no more than the payment."],
  allocation_exceeds_balance: [
    409,
    "The allocation is more than the invoice's outstanding balance. Allocate the balance and record the rest as unallocated.",
  ],
};

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);
    // INV-11: one explicit page with the exact total, never a silent cap.
    const page = parseListPage(request.nextUrl.searchParams);
    const { data, error, count } = await admin
      .from("customer_payments")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: false })
      .order("id", { ascending: false })
      .range(page.from, page.to);

    if (error) throw new Error(error.message);
    return NextResponse.json({
      payments: data ?? [],
      pagination: listPageInfo(page, count, (data ?? []).length),
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const tenantId = String(body.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const parsed = parsePaymentInput(body, operatorDay(new Date()));
    if (!parsed.ok) {
      throw new AccountsHttpError(400, parsed.message, "invalid_payment");
    }

    const input = parsed.value;

    const { data: paymentId, error } = await admin.rpc("accounts_record_customer_payment", {
      p_tenant_id: tenantId,
      p_customer_id: input.customerId,
      p_user_id: user.id,
      p_payment_date: input.paymentDate,
      p_amount: input.amount,
      p_currency: input.currency,
      p_payment_method: input.paymentMethod,
      p_payment_reference: input.paymentReference,
      p_bank_reference: input.bankReference,
      p_notes: input.notes,
      p_invoice_id: input.invoiceId,
      p_allocate_amount: input.allocateAmount,
    });

    if (error) {
      throw rpcFailure(error, PAYMENT_MESSAGES, "prodfix_40_accounts_payment_allocation.sql");
    }

    return NextResponse.json({ ok: true, paymentId }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
