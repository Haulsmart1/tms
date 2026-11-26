import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "../../../../../lib/api/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { bankDatabaseError, decryptBankDetails, bankDetailsScope } from "../../../../../lib/accounts/subcontractorBankServer";
import {
  readJsonBody, requireSubcontractorInTenant, requireSubcontractorWriter, subcontractorApiError,
} from "../../../../../lib/subcontractors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const reviewSchema = z.strictObject({
  requestId: z.string().refine(isUuid),
  decision: z.enum(["approved", "rejected"]),
});

async function requireReviewAccess(request: NextRequest, { params }: Context) {
  const { id } = await params;
  const { admin, tenantId, userId } = await requireSubcontractorWriter(request, "manage");
  await requireSubcontractorInTenant(admin, id, tenantId);
  return { admin, tenantId, userId, id };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { admin, tenantId, userId, id } = await requireReviewAccess(request, context);
    const bank = admin.from("subcontractor_bank_details");
    const scope = bankDetailsScope(tenantId, id);
    const [pending, approved] = await Promise.all([
      bank.select("id, encrypted_details, submitted_at, submitted_by")
        .eq("tenant_id", tenantId).eq("subcontractor_id", id).eq("status", "pending").maybeSingle(),
      bank.select("encrypted_details, reviewed_at")
        .eq("tenant_id", tenantId).eq("subcontractor_id", id).eq("status", "approved")
        .order("submitted_at", { ascending: false }).order("id").limit(1).maybeSingle(),
    ]);
    if (pending.error || approved.error) throw bankDatabaseError((pending.error || approved.error)?.code);
    return NextResponse.json({
      pending: pending.data && {
        id: pending.data.id,
        submittedAt: pending.data.submitted_at,
        canReview: pending.data.submitted_by !== userId,
        details: decryptBankDetails(pending.data.encrypted_details, scope),
      },
      approved: approved.data && {
        reviewedAt: approved.data.reviewed_at,
        details: decryptBankDetails(approved.data.encrypted_details, scope),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return subcontractorApiError(error, "Bank details review");
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, tenantId, userId, id } = await requireReviewAccess(request, context);
    const parsed = reviewSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ApiError(400, "Choose a bank details request and a review decision.");
    const { requestId, decision } = parsed.data;
    const { data, error } = await admin.from("subcontractor_bank_details")
      .update({ status: decision, reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq("id", requestId).eq("tenant_id", tenantId).eq("subcontractor_id", id)
      .eq("status", "pending").neq("submitted_by", userId)
      .select("id").maybeSingle();
    if (error) throw bankDatabaseError(error.code);
    if (!data) throw new ApiError(409, "This request is no longer available for you to review.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return subcontractorApiError(error, "Bank details review");
  }
}
