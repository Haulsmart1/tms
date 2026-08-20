import { createAdminClient } from "../supabase/admin";

const POD_BUCKET = "pod-files";
const FILE_URL_LIFETIME_SECONDS = 15 * 60;

export type SharedPodEvidence = {
  id: string;
  evidenceType: string;
  filename: string;
  mimeType: string | null;
  fileSize: number | null;
  storagePath: string;
  signedUrl: string | null;
};

export type SharedPodStop = {
  id: string;
  stopOrder: number;
  type: string;
  address: string;
  city: string | null;
  postcode: string | null;
  status: string | null;
  podStatus: string | null;
  recipientName: string | null;
  deliveredAt: string | null;
  podNotes: string | null;
  evidence: SharedPodEvidence[];
};

export type SharedPodData = {
  jobId: string;
  reference: string;
  customerReference: string | null;
  status: string | null;
  scheduledDate: string | null;
  customerName: string;
  stops: SharedPodStop[];
};

export async function loadSharedPod(
  tenantId: string,
  jobId: string
): Promise<SharedPodData | null> {
  const admin = createAdminClient();

  const { data: job, error: jobError } =
    await admin
      .from("jobs")
      .select(`
        id,
        tenant_id,
        reference,
        customer_reference,
        status,
        scheduled_date,
        customers (
          name
        )
      `)
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

  if (jobError) {
    throw new Error(
      `Unable to load POD job: ${jobError.message}`
    );
  }

  if (!job) {
    return null;
  }

  const [
    { data: stops, error: stopsError },
    { data: evidence, error: evidenceError },
  ] = await Promise.all([
    admin
      .from("job_stops")
      .select(`
        id,
        tenant_id,
        job_id,
        stop_order,
        type,
        address_line,
        city,
        postcode,
        status,
        pod_status,
        recipient_name,
        delivered_at,
        pod_notes
      `)
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId)
      .order("stop_order", {
        ascending: true,
      }),

    admin
      .from("pod_evidence")
      .select(`
        id,
        tenant_id,
        job_id,
        stop_id,
        evidence_type,
        storage_path,
        original_filename,
        mime_type,
        file_size_bytes
      `)
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId)
      .order("created_at", {
        ascending: true,
      }),
  ]);

  if (stopsError) {
    throw new Error(
      `Unable to load POD stops: ${stopsError.message}`
    );
  }

  if (evidenceError) {
    throw new Error(
      `Unable to load POD evidence: ${evidenceError.message}`
    );
  }

  const evidenceRows = evidence ?? [];

  const paths = evidenceRows.map(
    (item) => item.storage_path as string
  );

  const signedUrls = new Map<string, string>();

  if (paths.length > 0) {
    const {
      data: signedData,
      error: signedError,
    } = await admin.storage
      .from(POD_BUCKET)
      .createSignedUrls(
        paths,
        FILE_URL_LIFETIME_SECONDS
      );

    if (signedError) {
      throw new Error(
        `Unable to sign POD evidence: ${signedError.message}`
      );
    }

    for (let index = 0; index < paths.length; index += 1) {
      const signedUrl =
        signedData?.[index]?.signedUrl ?? null;

      if (signedUrl) {
        signedUrls.set(
          paths[index],
          signedUrl
        );
      }
    }
  }

  const evidenceByStop =
    new Map<string, SharedPodEvidence[]>();

  for (const item of evidenceRows) {
    const stopId = item.stop_id as string;

    const current =
      evidenceByStop.get(stopId) ?? [];

    current.push({
      id: item.id as string,
      evidenceType:
        item.evidence_type as string,
      filename:
        (item.original_filename as string | null) ??
        "POD evidence",
      mimeType:
        item.mime_type as string | null,
      fileSize:
        item.file_size_bytes as number | null,
      storagePath:
        item.storage_path as string,
      signedUrl:
        signedUrls.get(
          item.storage_path as string
        ) ?? null,
    });

    evidenceByStop.set(
      stopId,
      current
    );
  }

  const customerRelation =
    job.customers as
      | { name?: string | null }
      | { name?: string | null }[]
      | null;

  const customerName =
    Array.isArray(customerRelation)
      ? customerRelation[0]?.name
      : customerRelation?.name;

  return {
    jobId: job.id as string,
    reference:
      (job.reference as string | null) ??
      "No job reference",
    customerReference:
      job.customer_reference as string | null,
    status:
      job.status as string | null,
    scheduledDate:
      job.scheduled_date as string | null,
    customerName:
      customerName ??
      "No customer",
    stops: (stops ?? []).map((stop) => ({
      id: stop.id as string,
      stopOrder:
        stop.stop_order as number,
      type: stop.type as string,
      address:
        stop.address_line as string,
      city:
        stop.city as string | null,
      postcode:
        stop.postcode as string | null,
      status:
        stop.status as string | null,
      podStatus:
        stop.pod_status as string | null,
      recipientName:
        stop.recipient_name as string | null,
      deliveredAt:
        stop.delivered_at as string | null,
      podNotes:
        stop.pod_notes as string | null,
      evidence:
        evidenceByStop.get(
          stop.id as string
        ) ?? [],
    })),
  };
}
