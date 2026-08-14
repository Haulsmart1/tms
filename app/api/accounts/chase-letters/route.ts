import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);
    const { data, error } = await admin
      .from("customer_chase_letters")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ chaseLetters: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const customerId = String(body.customerId ?? "").trim();

    if (!tenantId || !customerId) {
      return NextResponse.json(
        { error: "tenantId and customerId are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: invoices, error: invoiceError } = await admin
      .from("invoices")
      .select("id,due_date,balance_due,invoice_number")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .gt("balance_due", 0)
      .lt("due_date", new Date().toISOString().slice(0, 10));

    if (invoiceError) throw new Error(invoiceError.message);

    const outstanding = (invoices ?? []).reduce(
      (sum, invoice) => sum + Number(invoice.balance_due ?? 0),
      0
    );

    const oldestDueDate = (invoices ?? [])
      .map((invoice) => invoice.due_date)
      .filter(Boolean)
      .sort()[0] ?? null;

    const daysOverdue = oldestDueDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(`${oldestDueDate}T00:00:00`).getTime()) /
              86400000
          )
        )
      : 0;

    const { data: chase, error } = await admin
      .from("customer_chase_letters")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        chase_level: body.chaseLevel || "reminder_1",
        subject: body.subject || "Outstanding account reminder",
        body: body.body || null,
        outstanding_balance: outstanding,
        oldest_due_date: oldestDueDate,
        days_overdue: daysOverdue,
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    if ((invoices ?? []).length > 0) {
      const { error: linkError } = await admin
        .from("customer_chase_letter_invoices")
        .insert(
          (invoices ?? []).map((invoice) => ({
            tenant_id: tenantId,
            chase_letter_id: chase.id,
            invoice_id: invoice.id,
            outstanding_amount: Number(invoice.balance_due ?? 0),
          }))
        );

      if (linkError) throw new Error(linkError.message);
    }

    return NextResponse.json({ ok: true, chaseLetterId: chase.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
