import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { requireSubcontractorPortal } from "../../../../lib/accounts/subcontractorPortal";
import { subcontractorApiError } from "../../../../lib/subcontractors/server";
import { canViewSubcontractorInvoices } from "../../../../lib/accounts/portalScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const { admin, link } = await requireSubcontractorPortal(request.nextUrl.searchParams.get("link"));
    if (!canViewSubcontractorInvoices(link.role)) throw new ApiError(403, "You cannot view invoices.");
    const id = request.nextUrl.searchParams.get("download");
    const scoped = admin.from("subcontractor_portal_invoices")
      .select("id, invoice_number, issue_date")
      .eq("tenant_id", link.tenant_id).eq("subcontractor_id", link.subcontractor_id);
    if (id !== null) {
      if (!isUuid(id)) throw new ApiError(404, "Invoice not found.");
      const { data, error } = await scoped.eq("id", id).maybeSingle();
      if (error) throw apiDbError(error, "Unable to load the invoice.");
      if (!data) throw new ApiError(404, "Invoice not found.");
      const { data: file, error: fileError } = await admin.storage.from("subcontractor-invoices")
        .download(`${link.tenant_id}/${link.subcontractor_id}/${data.id}.pdf`);
      if (fileError || !file) throw new ApiError(404, "Invoice PDF unavailable.");
      const filename = String(data.invoice_number).replace(/[^A-Za-z0-9_-]/g, "_");
      return new Response(file, { headers: { ...PRIVATE, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`, "X-Content-Type-Options": "nosniff" } });
    }
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new ApiError(400, "Invalid page.");
    const { data, error } = await scoped.order("issue_date", { ascending: false }).order("id")
      .range((page - 1) * 25, page * 25);
    if (error) throw apiDbError(error, "Unable to load invoices.");
    return NextResponse.json({ invoices: data.slice(0, 25), hasNext: data.length > 25 }, { headers: PRIVATE });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor invoices");
  }
}
