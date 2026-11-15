import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../../lib/api/server";
import {
  requireSubcontractorInTenant, requireSubcontractorWriter, subcontractorApiError,
} from "../../../../../lib/subcontractors/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, tenantId } = await requireSubcontractorWriter(request, "manage");
    const { id: subcontractorId } = await context.params;
    await requireSubcontractorInTenant(admin, subcontractorId, tenantId);
    const form = await request.formData().catch(() => null);
    const reference = form?.get("invoiceNumber");
    const issueDate = form?.get("issueDate");
    const file = form?.get("invoice");
    if (typeof reference !== "string" || !reference.trim() || reference.trim().length > 100) {
      throw new ApiError(400, "Enter an invoice number of up to 100 characters.");
    }
    if (typeof issueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate) ||
      !Number.isFinite(Date.parse(issueDate)) || new Date(issueDate).toISOString().slice(0, 10) !== issueDate) {
      throw new ApiError(400, "Enter a valid invoice date.");
    }
    // Fit Vercel's request size limit, including multipart overhead.
    if (!(file instanceof File) || file.size > 4_000_000 ||
      await file.slice(0, 5).text() !== "%PDF-") throw new ApiError(400, "Choose a PDF up to 4 MB.");

    const id = crypto.randomUUID();
    const path = `${tenantId}/${subcontractorId}/${id}.pdf`;
    const bucket = admin.storage.from("subcontractor-invoices");
    const upload = await bucket.upload(path, file, { contentType: "application/pdf" });
    if (upload.error) {
      console.error("[subcontractor invoice upload]", upload.error.name);
      throw new ApiError(500, "Unable to upload the PDF.");
    }
    const { error } = await admin.from("subcontractor_portal_invoices").insert({
      id, tenant_id: tenantId, subcontractor_id: subcontractorId,
      invoice_number: reference.trim(), issue_date: issueDate,
    });
    if (error) {
      const cleanup = await bucket.remove([path]);
      if (cleanup.error) console.error("[subcontractor invoice cleanup]", cleanup.error.name);
      if (error.code === "23505") throw new ApiError(409, "This invoice number is already published for this subcontractor.");
      throw apiDbError(error, "Unable to publish the invoice.");
    }
    return NextResponse.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return subcontractorApiError(error, "Publish subcontractor invoice");
  }
}
