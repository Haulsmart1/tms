import { NextRequest, NextResponse } from "next/server";
import { loadBrandingRecords } from "../../../../../lib/accounts/documentBranding";
import { generateInvoicePdf } from "../../../../../lib/invoices/generatePdf";
import { parseSelfBillingDetails } from "../../../../../lib/invoices/selfBilling";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { addCalendarDays, isValidYmd } from "../../../../../lib/invoices/dates";
import { listPageInfo, parseListPage } from "../../../../../lib/accounts/listPaging";
import { ApiError, apiDbError } from "../../../../../lib/api/server";
import {
  readJsonBody, requireSubcontractorInTenant, requireSubcontractorWriter, subcontractorApiError,
} from "../../../../../lib/subcontractors/server";

export const runtime = "nodejs";

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId } = await requireSubcontractorWriter(request, "manage");
    const { id } = await context.params;
    await requireSubcontractorInTenant(admin, id, tenantId);
    const downloadId = request.nextUrl.searchParams.get("download");
    if (downloadId !== null) {
      if (!isUuid(downloadId)) throw new ApiError(404, "Invoice not found.");
      const { data: invoice, error } = await admin.from("subcontractor_portal_invoices")
        .select("invoice_number").eq("tenant_id", tenantId).eq("subcontractor_id", id)
        .eq("id", downloadId).maybeSingle();
      if (error) throw apiDbError(error, "Unable to load the invoice.");
      if (!invoice) throw new ApiError(404, "Invoice not found.");
      const { data: file, error: fileError } = await admin.storage.from("subcontractor-invoices")
        .download(`${tenantId}/${id}/${downloadId}.pdf`);
      if (fileError || !file) throw new ApiError(404, "Invoice PDF unavailable.");
      const filename = String(invoice.invoice_number).replace(/[^A-Za-z0-9_-]/g, "_");
      return new Response(file, { headers: { ...PRIVATE, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`, "X-Content-Type-Options": "nosniff" } });
    }
    const page = parseListPage(request.nextUrl.searchParams);
    const { data, count, error } = await admin.from("subcontractor_portal_invoices")
      .select("id, invoice_number, issue_date, expected_payment_date", { count: "exact" })
      .eq("tenant_id", tenantId).eq("subcontractor_id", id)
      .order("issue_date", { ascending: false }).order("id").range(page.from, page.to);
    if (error) throw apiDbError(error, "Unable to load published invoices.");
    return NextResponse.json({ invoices: data, pagination: listPageInfo(page, count, data.length) }, { headers: PRIVATE });
  } catch (error) {
    return subcontractorApiError(error, "Load published invoices");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, tenantId } = await requireSubcontractorWriter(request, "manage");
    const { id } = await context.params;
    await requireSubcontractorInTenant(admin, id, tenantId);
    const body = await readJsonBody(request) as { invoiceId?: unknown; expectedPaymentDate?: unknown } | null;
    const invoiceId = body?.invoiceId;
    const date = typeof body?.expectedPaymentDate === "string" ? body.expectedPaymentDate.trim() : null;
    if (typeof invoiceId !== "string" || !isUuid(invoiceId)) throw new ApiError(404, "Invoice not found.");
    if (typeof date !== "string" || !isValidYmd(date)) throw new ApiError(400, "Enter a valid expected payment date.");
    const { data, error } = await admin.from("subcontractor_portal_invoices")
      .update({ expected_payment_date: date })
      .eq("tenant_id", tenantId).eq("subcontractor_id", id).eq("id", invoiceId)
      .select("id").maybeSingle();
    if (error?.code === "23514") throw new ApiError(400, "Expected payment date must be on or after the invoice date.");
    if (error) throw apiDbError(error, "Unable to update the expected payment date.");
    if (!data) throw new ApiError(404, "Invoice not found.");
    return NextResponse.json({ id: data.id, expectedPaymentDate: date }, { headers: PRIVATE });
  } catch (error) {
    return subcontractorApiError(error, "Update invoice payment date");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, tenantId } = await requireSubcontractorWriter(request, "manage");
    const { id: subcontractorId } = await context.params;
    if (!isUuid(subcontractorId)) throw new ApiError(404, "Subcontractor not found.");
    const { data: subcontractor, error: lookupError } = await admin.from("subcontractors")
      .select("payment_terms_days, name, legal_name, address, company_number, vat_number").eq("tenant_id", tenantId).eq("id", subcontractorId).maybeSingle();
    if (lookupError) throw apiDbError(lookupError, "Unable to load the subcontractor.");
    if (!subcontractor) throw new ApiError(404, "Subcontractor not found.");
    const form = await request.formData().catch(() => null);
    const reference = form?.get("invoiceNumber");
    const issueDateField = form?.get("issueDate");
    const issueDate = typeof issueDateField === "string" ? issueDateField.trim() : null;
    const mode = form?.get("mode");
    if (typeof reference !== "string" || !reference.trim() || reference.trim().length > 100) {
      throw new ApiError(400, "Enter an invoice number of up to 100 characters.");
    }
    if (typeof issueDate !== "string" || !isValidYmd(issueDate)) {
      throw new ApiError(400, "Enter a valid invoice date.");
    }
    const override = form?.get("expectedPaymentDate");
    const expectedPaymentDate = (typeof override === "string" ? override.trim() : override) ||
      addCalendarDays(issueDate, subcontractor.payment_terms_days ?? 30);
    if (typeof expectedPaymentDate !== "string" || !isValidYmd(expectedPaymentDate) || expectedPaymentDate < issueDate) {
      throw new ApiError(400, "Expected payment date must be on or after the invoice date.");
    }
    let pdf: Blob;
    if (mode === "preview" || mode === "generate") {
      const details = parseSelfBillingDetails(form?.get("supplyDate") ?? null, form?.get("lines") ?? null);
      if (details.error) throw new ApiError(400, details.error);
      const supplierVat = subcontractor.vat_number?.trim();
      if (details.usesVat && !supplierVat) {
        throw new ApiError(400, "Add the subcontractor’s VAT registration number or choose No VAT for the invoice lines.");
      }
      if (mode === "generate" && form?.get("selfBillingAgreement") !== "on") {
        throw new ApiError(400, "Confirm the self-billing agreement before issuing the invoice.");
      }

      const { companyProfile } = await loadBrandingRecords(admin, tenantId);
      const customerName = companyProfile?.company_name?.trim();
      const customerAddress = [companyProfile?.address_line_1, companyProfile?.address_line_2,
        companyProfile?.city, companyProfile?.region, companyProfile?.postcode, companyProfile?.country_code]
        .map((value) => String(value ?? "").trim()).filter(Boolean).join(", ");
      const supplierName = subcontractor.legal_name?.trim() || subcontractor.name?.trim();
      const supplierAddress = subcontractor.address?.trim();
      if (!customerName || !customerAddress) {
        throw new ApiError(400, "Add your company name and address in Settings → Company Profile.");
      }
      if (!supplierName || !supplierAddress) {
        throw new ApiError(400, "Add the supplier’s name and address in Subcontractors.");
      }

      const document = await generateInvoicePdf({
        companyName: supplierName,
        companyProfile: {
          address_line_1: supplierAddress,
          registration_number: subcontractor.company_number,
          vat_number: details.usesVat ? supplierVat : null,
        },
        customerName,
        selfBilling: { customerAddress, customerVatNumber: companyProfile.vat_number,
          supplyDate: details.supplyDate, draft: mode === "preview" },
        status: mode === "preview" ? "Draft" : "Issued",
        invoiceNumber: reference.trim(), issueDate, dueDate: expectedPaymentDate,
        currency: "GBP", subtotal: details.totals.subtotal, vatTotal: details.totals.vat,
        total: details.totals.total, balanceDue: details.totals.total, amountPaid: 0, creditTotal: 0,
        lines: details.lines,
        notes: details.usesVat ? "The VAT shown is your output tax due to HMRC." : null,
      });
      pdf = new Blob([Uint8Array.from(document.bytes)], { type: "application/pdf" });
      if (mode === "preview") return new Response(pdf, { headers: { ...PRIVATE, "Content-Type": "application/pdf" } });
    } else {
      // Keep the existing upload workflow for invoices issued elsewhere.
      const file = form?.get("invoice");
      if (!(file instanceof File) || file.size > 4_000_000 ||
        await file.slice(0, 5).text() !== "%PDF-") throw new ApiError(400, "Choose a PDF up to 4 MB.");
      pdf = file;
    }

    const id = crypto.randomUUID();
    const path = `${tenantId}/${subcontractorId}/${id}.pdf`;
    const bucket = admin.storage.from("subcontractor-invoices");
    const upload = await bucket.upload(path, pdf, { contentType: "application/pdf" });
    if (upload.error) {
      console.error("[subcontractor invoice upload]", upload.error.name);
      throw new ApiError(500, "Unable to upload the PDF.");
    }
    const { error } = await admin.from("subcontractor_portal_invoices").insert({
      id, tenant_id: tenantId, subcontractor_id: subcontractorId,
      invoice_number: reference.trim(), issue_date: issueDate, expected_payment_date: expectedPaymentDate,
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
