"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Stat from "../../components/Stat";
import Tabs from "../../components/Tabs";
import PodQueue from "./PodQueue";
import PodRail from "./PodRail";
import PodForm from "./PodForm";
import { splitDeliveryStops, type PodJob } from "../../lib/pod/queue";
import { attentionItems, podKpis } from "../../lib/pod/kpis";

const POD_BUCKET = "pod-files";

export default function PodPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [jobs, setJobs] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [savingStopId, setSavingStopId] = useState(null);
  const [uploadingField, setUploadingField] = useState("");
  const [forms, setForms] = useState<Record<string, any>>({});

  const [tab, setTab] = useState<"awaiting" | "completed">("awaiting");
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [podJobs, setPodJobs] = useState<PodJob[]>([]);
  /* The queue needs three states the old page had no concept of. Without
     them DataTable's skeleton, error and empty branches are unreachable and
     an empty queue renders a bare header with no explanation. */
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // One `now` per load, injected into every pure function, so the KPI tiles,
  // the queue order and the attention list cannot disagree by a few
  // milliseconds about what "overdue" means.
  const now = useMemo(() => new Date(), [podJobs]);

  const { awaiting, completed } = useMemo(
    () => splitDeliveryStops(podJobs, now),
    [podJobs, now],
  );

  const jobPrices = useMemo(
    () => new Map(podJobs.map((j) => [j.id, j.customer_price ?? 0])),
    [podJobs],
  );

  const kpis = useMemo(
    () => podKpis(awaiting, completed, jobPrices, now),
    [awaiting, completed, jobPrices, now],
  );

  const attention = useMemo(() => attentionItems(awaiting), [awaiting]);

  async function loadJobs() {
    setMessage("");
    setLoading(true);

    const { data, error } = await tenant
      .filterByTenant(
        supabase
          .from("jobs")
          .select(`
        id,
        reference,
        status,
        scheduled_date,
        customer_price,
        customers (
          name
        ),
        vehicles (
          registration,
          make,
          model
        ),
        drivers (
          name
        ),
        job_stops (
          id,
          tenant_id,
          stop_order,
          type,
          address_line,
          city,
          postcode,
          status,
          pod_status,
          recipient_name,
          planned_at,
          delivered_at,
          pod_notes,
          pod_photo_url,
          pod_document_url,
          pod_updated_at
        )
      `)
      )
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Load error: ${error.message}`);
      setLoadFailed(true);
      setLoading(false);
      return;
    }

    const normalized = (data || []).map((job: any) => ({
      ...job,
      job_stops: [...(job.job_stops || [])].sort(
        (a, b) => a.stop_order - b.stop_order
      )
    }));

    setJobs(normalized);

    const podJobs: PodJob[] = normalized.map((job: any) => ({
      id: job.id,
      reference: job.reference,
      status: job.status,
      scheduled_date: job.scheduled_date,
      customer_name: job.customers?.name ?? null,
      vehicle_registration: job.vehicles?.registration ?? null,
      vehicle_model: [job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ") || null,
      driver_name: job.drivers?.name ?? null,
      customer_price: job.customer_price === null ? null : Number(job.customer_price),
      stops: job.job_stops ?? [],
    }));
    setPodJobs(podJobs);

    const nextForms: Record<string, any> = {};
    normalized.forEach((job: any) => {
      (job.job_stops || []).forEach((stop: any) => {
        nextForms[stop.id] = {
          tenant_id: stop.tenant_id,
          recipient_name: stop.recipient_name || "",
          pod_notes: stop.pod_notes || "",
          pod_photo_url: stop.pod_photo_url || "",
          pod_document_url: stop.pod_document_url || ""
        };
      });
    });

    setForms(nextForms);
    setLoadFailed(false);
    setLoading(false);
  }

  useEffect(() => {
    loadJobs();
  }, [tenant.activeTenantId]);

  function updateForm(stopId: any, field: any, value: any) {
    setForms((current: any) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name || "",
        pod_notes: current[stopId]?.pod_notes || "",
        pod_photo_url: current[stopId]?.pod_photo_url || "",
        pod_document_url: current[stopId]?.pod_document_url || "",
        [field]: value
      }
    }));
  }

  async function uploadFile(file: any, stopId: any, stopTenantId: any, fieldName: any) {
    if (!file) {
      return;
    }

    if (!stopTenantId) {
      setMessage("This stop has no tenant; cannot upload.");
      return;
    }

    setUploadingField(`${stopId}-${fieldName}`);
    setMessage("");

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${stopTenantId}/${stopId}/${fieldName}-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(POD_BUCKET)
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      setUploadingField("");
      setMessage(`Upload error: ${uploadError.message}`);
      return;
    }

    updateForm(stopId, fieldName, filePath);

    setUploadingField("");
    setMessage(
      fieldName === "pod_photo_url" ? "Photo uploaded." : "Document uploaded."
    );
  }

  async function savePod(stopId: any, markDelivered: any) {
    const form = forms[stopId] || {
      recipient_name: "",
      pod_notes: "",
      pod_photo_url: "",
      pod_document_url: ""
    };

    setSavingStopId(stopId);
    setMessage("");

    const updatePayload: Record<string, any> = {
      recipient_name: form.recipient_name.trim() || null,
      pod_notes: form.pod_notes.trim() || null,
      pod_photo_url: form.pod_photo_url.trim() || null,
      pod_document_url: form.pod_document_url.trim() || null,
      pod_updated_at: new Date().toISOString()
    };

    if (markDelivered) {
      updatePayload.delivered_at = new Date().toISOString();
      updatePayload.pod_status = "delivered";
      updatePayload.status = "completed";
    }

    const { error } = await supabase
      .from("job_stops")
      .update(updatePayload)
      .eq("id", stopId);

    if (error) {
      setSavingStopId(null);
      setMessage(`Save error: ${error.message}`);
      return;
    }

    if (markDelivered) {
      const job = jobs.find((j: any) =>
        (j.job_stops || []).some((s: any) => s.id === stopId)
      );

      if (job) {
        const { data: deliveryStops, error: deliveryError } = await supabase
          .from("job_stops")
          .select("id, pod_status")
          .eq("job_id", job.id)
          .eq("type", "delivery");

        if (!deliveryError) {
          const allDelivered =
            (deliveryStops || []).length > 0 &&
            deliveryStops.every((stop: any) => stop.pod_status === "delivered");

          if (allDelivered) {
            await supabase
              .from("jobs")
              .update({ status: "completed" })
              .eq("id", job.id);
          }
        }
      }
    }

    setSavingStopId(null);
    setMessage(markDelivered ? "POD saved and stop delivered." : "POD updated.");
    await loadJobs();
  }

  const rows = tab === "awaiting" ? awaiting : completed;
  const queueState = loading
    ? "loading"
    : loadFailed
      ? "error"
      : rows.length === 0
        ? "empty"
        : "ready";

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <div className="text-kicker uppercase text-ink-3">Proof of delivery</div>
          <h1 className="mb-4 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Delivery stops awaiting POD
          </h1>

          {message ? (
            <div className="mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink">
              {message}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
            {/* The QUEUE is first in the DOM and the rail second, so when the
                two stack below 1280px the queue comes first: it is the work,
                the rail is context. On xl the order classes swap them, putting
                the rail into the 400px left column. DOM order also decides
                keyboard and screen-reader order, which is the other reason the
                queue leads. */}
            <div className="min-w-0 xl:order-2">
              <div className="mb-3 grid grid-cols-3 gap-2.5">
                <Stat label="Awaiting POD" value={String(kpis.awaiting)} />
                <Stat label="Delivered today" value={String(kpis.deliveredToday)} subTone="positive" />
                <Stat
                  label="Overdue > 48 h"
                  value={String(kpis.overdue)}
                  subTone="danger"
                  sub={kpis.overdue > 0 ? "cannot invoice" : undefined}
                />
              </div>

              <div className="mb-3">
                <Tabs
                  label="Proof of delivery views"
                  activeId={tab}
                  onChange={(id) => {
                    setTab(id as "awaiting" | "completed");
                    setExpandedStopId(null);
                  }}
                  tabs={[
                    { id: "awaiting", label: "Awaiting", count: awaiting.length },
                    { id: "completed", label: "Completed", count: completed.length },
                  ]}
                />
              </div>

              <PodQueue
                rows={rows}
                state={queueState}
                expandedStopId={expandedStopId}
                onRowClick={(r) => setExpandedStopId(expandedStopId === r.stopId ? null : r.stopId)}
                onRetry={loadJobs}
                emptyTitle={tab === "awaiting" ? "No PODs awaiting" : "Nothing completed yet"}
                renderExpanded={(r) => (
                  <PodForm
                    stopId={r.stopId}
                    values={forms[r.stopId] ?? {
                      recipient_name: "", pod_notes: "", pod_photo_url: "", pod_document_url: "",
                    }}
                    saving={savingStopId === r.stopId}
                    uploadingField={uploadingField}
                    onChange={(field, value) => updateForm(r.stopId, field, value)}
                    onUpload={(file, field) => {
                      const stop = r.stops.find((s) => s.id === r.stopId);
                      uploadFile(file, r.stopId, (stop as any)?.tenant_id, field);
                    }}
                    onSave={(markDelivered) => savePod(r.stopId, markDelivered)}
                  />
                )}
              />
            </div>

            <div className="xl:order-1">
              <PodRail kpis={kpis} attention={attention} />
            </div>
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
