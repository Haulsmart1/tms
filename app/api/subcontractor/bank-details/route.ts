import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "../../../../lib/api/server";
import { requireSubcontractorPortal } from "../../../../lib/accounts/subcontractorPortal";
import { bankDetailsSchema } from "../../../../lib/accounts/subcontractorBank";
import { bankDatabaseError, encryptBankDetails, bankDetailsScope } from "../../../../lib/accounts/subcontractorBankServer";
import { readJsonBody, subcontractorApiError } from "../../../../lib/subcontractors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireBankAccess(request: NextRequest) {
  const context = await requireSubcontractorPortal(request.nextUrl.searchParams.get("link"));
  if (context.link.role !== "subcontractor_admin") throw new ApiError(403, "Only a subcontractor admin can manage bank details.");
  return context;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, link } = await requireBankAccess(request);
    const bank = admin.from("subcontractor_bank_details");
    const [latest, approved] = await Promise.all([
      bank.select("status, account_last_four")
        .eq("tenant_id", link.tenant_id).eq("subcontractor_id", link.subcontractor_id).order("submitted_at", { ascending: false }).order("id").limit(1).maybeSingle(),
      bank.select("account_last_four")
        .eq("tenant_id", link.tenant_id).eq("subcontractor_id", link.subcontractor_id).eq("status", "approved")
        .order("submitted_at", { ascending: false }).order("id").limit(1).maybeSingle(),
    ]);
    if (latest.error || approved.error) throw bankDatabaseError((latest.error || approved.error)?.code);
    return NextResponse.json({ latest: latest.data, approved: approved.data }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor bank details");
  }
}

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, link } = await requireBankAccess(request);
    const parsed = bankDetailsSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ApiError(400, "Enter an account name, a six-digit sort code and an eight-digit account number.");
    const lastFour = parsed.data.accountNumber.slice(-4);
    const { error } = await admin.from("subcontractor_bank_details").insert({
      tenant_id: link.tenant_id,
      subcontractor_id: link.subcontractor_id,
      encrypted_details: encryptBankDetails(parsed.data, bankDetailsScope(link.tenant_id, link.subcontractor_id)),
      account_last_four: lastFour,
      submitted_by: link.user_id,
    });
    if (error?.code === "23505") throw new ApiError(409, "A bank details request is already awaiting review.");
    if (error) throw bankDatabaseError(error.code);
    return NextResponse.json({ latest: { status: "pending", account_last_four: lastFour } }, { status: 201 });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor bank details");
  }
}
