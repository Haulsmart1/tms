import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

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
    const body = await request.json();

    const tenantId = String(
      body.tenantId ?? ""
    ).trim();

    const { id } =
      await context.params;

    const quotationId = String(
      id ?? ""
    ).trim();

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        { status: 400 }
      );
    }

    if (!quotationId) {
      return NextResponse.json(
        {
          error:
            "Quotation id is required.",
        },
        { status: 400 }
      );
    }

    const { admin } =
      await requireTenantAccess(
        tenantId
      );

    const {
      data: jobId,
      error,
    } = await admin.rpc(
      "convert_quotation_to_job",
      {
        p_quotation_id:
          quotationId,
        p_tenant_id:
          tenantId,
      }
    );

    if (error) {
      const message =
        error.message ||
        "Unable to convert quotation.";

      return NextResponse.json(
        { error: message },
        {
          status:
            message.includes(
              "accepted"
            ) ||
            message.includes(
              "at least one stop"
            )
              ? 409
              : 400,
        }
      );
    }

    if (!jobId) {
      throw new Error(
        "Quotation conversion returned no Job ID."
      );
    }

    return NextResponse.json({
      ok: true,
      quotationId,
      jobId,
      jobUrl:
        `/jobs?job=${encodeURIComponent(
          String(jobId)
        )}`,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}