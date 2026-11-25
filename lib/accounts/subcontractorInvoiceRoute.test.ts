import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../app/api/subcontractor/invoices/route";
import { PATCH } from "../../app/api/subcontractor/me/route";
import { requireSubcontractorPortal } from "./subcontractorPortal";
import { subcontractorDetailFields } from "./subcontractorDetails";

vi.mock("./subcontractorPortal", () => ({ requireSubcontractorPortal: vi.fn() }));
vi.mock("../../lib/subcontractors/server", () => ({
  subcontractorApiError: (error: { status: number; message: string }) => Response.json({ error: error.message }, { status: error.status }),
}));

const invoiceId = "fb607eb5-1ce7-495a-9faa-ad59249c9953";
const from = vi.fn();
const download = vi.fn();
const storage = { from: vi.fn(() => ({ download })) };
const link = { role: "subcontractor_admin", tenant_id: "tenant", subcontractor_id: "supplier" };

beforeEach(() => {
  vi.resetAllMocks();
  storage.from.mockReturnValue({ download });
  vi.mocked(requireSubcontractorPortal).mockResolvedValue({ admin: { from, storage }, link } as never);
});

it("scopes the invoice lookup before reading storage and rejects another company's document", async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  from.mockReturnValue(query);
  const response = await GET(new NextRequest(`https://tms.invalid/api/subcontractor/invoices?download=${invoiceId}`));
  expect(response.status).toBe(404);
  expect(query.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["subcontractor_id", "supplier"], ["id", invoiceId]]);
  expect(storage.from).not.toHaveBeenCalled();
});

it("lets accounts download its own PDF as a private attachment", async () => {
  vi.mocked(requireSubcontractorPortal).mockResolvedValue({ admin: { from, storage }, link: { ...link, role: "accounts" } } as never);
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: invoiceId, invoice_number: "SB-12" }, error: null }) };
  from.mockReturnValue(query);
  download.mockResolvedValue({ data: new Blob(["%PDF-1.7"]), error: null });
  const response = await GET(new NextRequest(`https://tms.invalid/api/subcontractor/invoices?download=${invoiceId}`));
  expect(response.status).toBe(200);
  expect(download).toHaveBeenCalledWith(`tenant/supplier/${invoiceId}.pdf`);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="SB-12.pdf"');
});

it("includes the stored expected date in the scoped portal list", async () => {
  const invoice = { id: invoiceId, invoice_number: "SB-12", issue_date: "2026-11-25", expected_payment_date: "2026-12-18" };
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [invoice], error: null }),
  };
  from.mockReturnValue(query);

  const response = await GET(new NextRequest("https://tms.invalid/api/subcontractor/invoices"));
  expect(response.status).toBe(200);
  expect(query.select).toHaveBeenCalledWith("id, invoice_number, issue_date, expected_payment_date");
  expect(query.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["subcontractor_id", "supplier"]]);
  expect(await response.json()).toEqual({ invoices: [invoice], hasNext: false });
});

it("denies dispatchers before querying invoices", async () => {
  vi.mocked(requireSubcontractorPortal).mockResolvedValue({ admin: { from }, link: { ...link, role: "dispatcher" } } as never);
  const response = await GET(new NextRequest("https://tms.invalid/api/subcontractor/invoices"));
  expect(response.status).toBe(403);
  expect(from).not.toHaveBeenCalled();
});

it("rejects changes to payment rates through the company details form", async () => {
  const values = Object.fromEntries(subcontractorDetailFields.map(([key]) => [key, ""]));
  const response = await PATCH(new NextRequest("https://tms.invalid/api/subcontractor/me", {
    method: "PATCH", headers: { origin: "https://tms.invalid" }, body: JSON.stringify({ ...values, default_rate: 999 }),
  }));
  expect(response.status).toBe(400);
  expect(from).not.toHaveBeenCalled();
});

it("allows an admin to add a contact using their portal link's company and tenant", async () => {
  const values = Object.fromEntries(subcontractorDetailFields.map(([key]) => [key, ""]));
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "supplier" }, error: null }) };
  from.mockReturnValue(query);
  const response = await PATCH(new NextRequest("https://tms.invalid/api/subcontractor/me", {
    method: "PATCH", headers: { origin: "https://tms.invalid" }, body: JSON.stringify({ ...values, email: "ops@example.com" }),
  }));
  expect(response.status).toBe(200);
  expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ email: "ops@example.com" }));
  expect(query.eq.mock.calls).toEqual([["id", "supplier"], ["tenant_id", "tenant"], ["active", true]]);
});
