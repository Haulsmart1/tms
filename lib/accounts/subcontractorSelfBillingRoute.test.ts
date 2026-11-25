import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/subcontractors/[id]/invoices/route";

const supplierId = "30169348-62b6-4fde-8508-a257f45bd865";
const mocks = vi.hoisted(() => ({
  from: vi.fn(), source: vi.fn(), upload: vi.fn(), insert: vi.fn(), render: vi.fn(),
}));
vi.mock("../subcontractors/server", () => ({
  requireSubcontractorWriter: async () => ({
    admin: { from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } },
    tenantId: "workspace",
  }),
  subcontractorApiError: (error: { message: string; status: number }) =>
    Response.json({ error: error.message }, { status: error.status }),
}));
vi.mock("./documentBranding", () => ({
  loadBrandingRecords: async () => ({ companyProfile: { company_name: "Workspace Ltd", address_line_1: "1 Depot Road" } }),
}));
vi.mock("../invoices/generatePdf", () => ({ generateInvoicePdf: mocks.render }));

beforeEach(() => {
  vi.clearAllMocks();
  const supplier = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ error: null, data: {
      legal_name: "Supplier Ltd", address: "2 Carrier Road", payment_terms_days: 30,
    } }),
  };
  mocks.from.mockImplementation((table: string) => {
    if (table === "subcontractors") return supplier;
    if (table === "subcontractor_self_billing_drafts") return mocks.source();
    return { insert: mocks.insert };
  });
  mocks.render.mockResolvedValue({ bytes: Uint8Array.from([37, 80, 68, 70]) });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
});

function post(mode: "preview" | "generate", agreed = false, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("mode", mode);
  form.set("invoiceNumber", "SB-12");
  form.set("issueDate", "2026-11-25");
  form.set("supplyDate", "2026-11-24");
  form.set("lines", JSON.stringify([{ description: "Transport", quantity: "1", unitPrice: "3800", vat: "none" }]));
  if (agreed) form.set("selfBillingAgreement", "on");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return POST(new NextRequest("https://tms.invalid/api/subcontractors/invoices", {
    method: "POST", body: form, headers: { origin: "https://tms.invalid" },
  }), { params: Promise.resolve({ id: supplierId }) });
}

it("previews a supplier-to-workspace PDF without writing an invoice", async () => {
  const response = await post("preview");
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({
    companyName: "Supplier Ltd", customerName: "Workspace Ltd", total: 3800,
    dueDate: "2026-12-25", selfBilling: expect.objectContaining({ draft: true }),
  }));
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("requires agreement for issuing and stores only the explicitly issued PDF", async () => {
  expect((await post("generate")).status).toBe(400);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect((await post("generate", true)).status).toBe(201);
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    tenant_id: "workspace", subcontractor_id: supplierId,
    invoice_number: "SB-12", expected_payment_date: "2026-12-25",
  }));
});

it("uses the recorded job cost and links the issued invoice to the signed-off job", async () => {
  const jobId = "d1891b7a-102e-4d77-b100-4061072b3ab9";
  const completedAt = "2026-11-25T15:00:00+00:00";
  const lookup = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ error: null, data: {
      id: jobId, reference: "JOB-1", completed_at: completedAt, subcontractor_cost: "1500.00",
    } }) };
  mocks.source.mockReturnValue(lookup);
  const details = { jobId, jobCost: "1500.00", jobCompletedAt: completedAt, jobReference: "JOB-1", jobVat: "none" };

  expect((await post("generate", true, { ...details, jobCost: "1300" })).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect((await post("generate", true, details)).status).toBe(201);
  expect(lookup.eq.mock.calls).toContainEqual(["tenant_id", "workspace"]);
  expect(lookup.eq.mock.calls).toContainEqual(["subcontractor_id", supplierId]);
  expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ total: 1500 }));
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
    source_job_id: jobId, source_job_cost: 1500, source_signed_off_at: completedAt,
  }));
});
