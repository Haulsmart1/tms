import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../../lib/api/server";
import { TenantAccessError, isUuid } from "../../../../lib/auth/serverTenantAccess";
import {
  canDeleteJobStatus,
  hasOperationalJobRecords,
  hasProtectedJobLinks,
} from "../../../../lib/jobs/deletePolicy";
import { authorizeOfficeTenant } from "../../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../../lib/supabase/admin";

/*
  Delete a job that never started (review POD-23): office callers only, and
  refused once POD evidence or barcode scans exist, because deleting would
  orphan the uploaded files.
*/
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;

    if (!isUuid(jobId)) {
      throw new ApiError(404, "Job not found");
    }

    const { supabase, tenantId, user } = await requireTenant(request);
    const admin = createAdminClient();

    try {
      await authorizeOfficeTenant(admin, user.id, tenantId);
    } catch (error) {
      if (error instanceof TenantAccessError && error.status === 403) {
        throw new ApiError(403, "Only office staff can delete jobs.");
      }
      throw new ApiError(500, "Unable to verify tenant access.");
    }

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
      podEvidenceResult,
      itemScansResult,
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
      // Service role: these must be counted even where RLS would hide rows.
      admin
        .from("pod_evidence")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("job_id", jobId),
      admin
        .from("job_item_scans")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("job_id", jobId),
    ]);

    const failedCheck = [
      invoiceJobsResult,
      invoicesResult,
      supplierPurchaseOrdersResult,
      podEvidenceResult,
      itemScansResult,
    ].find((result) => result.error);

    if (failedCheck?.error) {
      console.error("Job delete safety check failed", failedCheck.error);
      throw new ApiError(500, "Unable to verify whether this job can be deleted.");
    }

    if (
      hasProtectedJobLinks({
        invoiceJobs: invoiceJobsResult.data?.length ?? 0,
        invoices: invoicesResult.data?.length ?? 0,
        supplierPurchaseOrderJobs: supplierPurchaseOrdersResult.data?.length ?? 0,
      })
    ) {
      throw new ApiError(
        409,
        "This job is linked to financial or supplier records and cannot be deleted."
      );
    }

    if (
      hasOperationalJobRecords({
        podEvidence: podEvidenceResult.count ?? 0,
        itemScans: itemScansResult.count ?? 0,
      })
    ) {
      throw new ApiError(
        409,
        "This job already has POD evidence or barcode scans, so it cannot be deleted. Cancel it instead."
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
