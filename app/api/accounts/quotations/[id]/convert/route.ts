import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import { readJsonObject } from "../../../../../../lib/accounts/errors";
import { isUuid } from "../../../../../../lib/auth/serverTenantAccess";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const body = await readJsonObject(request);

    const tenantId = String(body.tenantId ?? "").trim();

    const { id } = await context.params;

    const quotationId = String(id ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    if (!quotationId) {
      return NextResponse.json({ error: "Quotation id is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);

    if (!isUuid(quotationId)) {
      return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
    }

    const { data: jobId, error } = await admin.rpc("convert_quotation_to_job", {
      p_quotation_id: quotationId,
      p_tenant_id: tenantId,
    });

    if (error) {
      // Review ACC-15: map the two known refusals, never echo database text.
      const raw = String(error.message ?? "");

      if (raw.includes("accepted")) {
        return NextResponse.json(
          { error: "Only quotations accepted by the customer can be converted to a job.", code: "not_accepted" },
          { status: 409 }
        );
      }

      if (raw.includes("at least one stop")) {
        return NextResponse.json(
          { error: "Add at least one stop before converting this quotation.", code: "no_stops" },
          { status: 409 }
        );
      }

      console.error("[quotations] convert failed", error.code, raw);

      return NextResponse.json({ error: "Unable to convert quotation.", code: "convert_failed" }, { status: 400 });
    }

    if (!jobId) {
      throw new Error("Quotation conversion returned no Job ID.");
    }

    return NextResponse.json({
      ok: true,
      quotationId,
      jobId,
      jobUrl: `/jobs?job=${encodeURIComponent(String(jobId))}`,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(result.body, { status: result.status });
  }
}
