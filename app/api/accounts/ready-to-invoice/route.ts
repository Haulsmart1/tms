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
      .from("jobs_ready_to_invoice")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("completed_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ jobs: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
