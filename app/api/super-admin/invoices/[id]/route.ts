import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { recordSuperAdminAudit } from "../../../../../lib/superAdmin/audit";
import { parseSuperAdminInvoiceStatus } from "../../../../../lib/superAdmin/invoiceStatus";
import { isUuid } from "../../../../../lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Marks a customer invoice paid or pending from the super-admin console.

   This used to be a browser write (app/super-admin/invoices/page.tsx called
   invoices.update({ status }) with the user's own key). It moved here because
   prodfix_95 revokes INSERT/UPDATE/DELETE on the ledger tables from every
   client role: the accounts API is the only writer of invoice state, and the
   super-admin action has to go through the service role like everything else.
   It also gains what the browser write never had: an audit row.

   The status list is closed (lib/superAdmin/invoiceStatus.ts). Void, credited
   and the rest belong to the accounts state machine and are not reachable
   from a platform-wide button. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: invoiceId } = await context.params;

    if (!isUuid(invoiceId)) {
      return NextResponse.json({ error: "No such invoice." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const parsed = parseSuperAdminInvoiceStatus(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    let admin;
    try {
      admin = createAdminClient();
    } catch (err) {
      console.error("super-admin invoice status: Supabase admin client unavailable", err);
      return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
    }

    // Same reason as the companies route: a zero-row update is not an error to
    // PostgREST, so prove the row exists first rather than report success on
    // a typo'd id.
    const { data: existing, error: lookupError } = await admin
      .from("invoices")
      .select("id, status")
      .eq("id", invoiceId)
      .maybeSingle();

    if (lookupError) {
      console.error("super-admin invoice status: lookup failed", lookupError.code);
      return NextResponse.json({ error: "Unable to update this invoice." }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "No such invoice." }, { status: 404 });
    }

    const { error: updateError } = await admin
      .from("invoices")
      .update({ status: parsed.status })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("super-admin invoice status: update failed", updateError.code);
      return NextResponse.json({ error: "Unable to update this invoice." }, { status: 500 });
    }

    logSuperAdminEdit({
      actorId,
      action: "invoice.status",
      targetId: invoiceId,
      changedFields: ["status"],
      result: "ok",
    });
    await recordSuperAdminAudit(admin, {
      actorId,
      action: "invoice.status",
      targetType: "invoice",
      targetId: invoiceId,
      changedFields: ["status"],
      result: "ok",
      details: { from: existing.status ?? null, to: parsed.status },
    });

    return NextResponse.json({ ok: true, status: parsed.status });
  },
);
