import { listPageInfo, parseListPage } from "../../../../lib/accounts/listPaging";
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

    // INV-11: one explicit page with the exact total, never a silent cap.
    const page = parseListPage(request.nextUrl.searchParams);
    const { data, error, count } = await admin
      .from("jobs_ready_to_invoice")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("completed_at", { ascending: false })
      .order("job_id", { ascending: false })
      .range(page.from, page.to);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      jobs: data ?? [],
      pagination: listPageInfo(page, count, (data ?? []).length),
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
