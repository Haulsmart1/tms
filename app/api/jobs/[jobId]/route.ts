import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../../lib/api/server";
import {
  canDeleteJobStatus,
  hasProtectedJobLinks,
} from "../../../../lib/jobs/deletePolicy";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const { supabase, tenantId } = await requireTenant(request);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id,status")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (jobError) {
      throw new ApiError(400, jobError.message);
    }

    if (!job) {
      throw new ApiError(404, "Job not found");
    }

    if (!canDeleteJobStatus(job.status)) {
      throw new ApiError(
        409,
        "Only jobs awaiting acceptance or planned jobs can be deleted."
      );
    }

    const [
      invoiceJobsResult,
      invoicesResult,
      supplierPurchaseOrdersResult,
    ] = await Promise.all([
      supabase
        .from("invoice_jobs")
        .select("id")
        .eq("job_id", jobId)
        .limit(1),
      supabase
        .from("invoices")
        .select("id")
        .eq("job_id", jobId)
        .limit(1),
      supabase
        .from("supplier_purchase_order_jobs")
        .select("id")
        .eq("job_id", jobId)
        .limit(1),
    ]);

    if (invoiceJobsResult.error) {
      console.error(
        "Job delete invoice_jobs safety check failed",
        invoiceJobsResult.error
      );

      throw new ApiError(
        500,
        `Unable to verify invoice links: ${invoiceJobsResult.error.message}`
      );
    }

    if (invoicesResult.error) {
      console.error(
        "Job delete invoices safety check failed",
        invoicesResult.error
      );

      throw new ApiError(
        500,
        `Unable to verify direct invoice links: ${invoicesResult.error.message}`
      );
    }

    if (supplierPurchaseOrdersResult.error) {
      console.error(
        "Job delete supplier purchase-order safety check failed",
        supplierPurchaseOrdersResult.error
      );

      throw new ApiError(
        500,
        `Unable to verify supplier links: ${supplierPurchaseOrdersResult.error.message}`
      );
    }

    const hasProtectedLinks = hasProtectedJobLinks({
      invoiceJobs: invoiceJobsResult.data?.length ?? 0,
      invoices: invoicesResult.data?.length ?? 0,
      supplierPurchaseOrderJobs:
        supplierPurchaseOrdersResult.data?.length ?? 0,
    });

    if (hasProtectedLinks) {
      throw new ApiError(
        409,
        "This job is linked to financial or supplier records and cannot be deleted."
      );
    }

    const { data: deletedJob, error: deleteError } = await supabase
      .from("jobs")
      .delete()
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();

    if (deleteError) {
      if (deleteError.code === "23503") {
        throw new ApiError(
          409,
          "This job is linked to protected records and cannot be deleted."
        );
      }

      throw new ApiError(400, deleteError.message);
    }

    if (!deletedJob) {
      throw new ApiError(404, "Job not found");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  console.error("Job delete API error", error);

  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
