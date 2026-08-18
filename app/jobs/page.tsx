"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { JobPageValidation, CollectionStopValidation, DeliveryStopValidation } from "../../lib/supabase/validation/job";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import JobForm from "./JobForm";
import StopCard from "./StopCard";
import DeleteJobDialog from "./DeleteJobDialog";
import Button from "../../components/Button";

const emptyStop = (type: "collection" | "delivery") => ({ type, address_line: "", city: "", postcode: "" });

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function JobsPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [jobs, setJobs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [podForms, setPodForms] = useState<Record<string, any>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; reference: string } | null>(null);

  const [acceptanceTarget, setAcceptanceTarget] = useState<{
    id: string;
    tenant_id: string;
    reference: string;
  } | null>(null);

  const [acceptanceForm, setAcceptanceForm] = useState({
    collection_eta: "",
    delivery_eta: "",
    acceptance_note: "",
  });

  const [accepting, setAccepting] = useState(false);

  const [form, setForm] = useState({
    reference: "", scheduled_date: "", customer_id: "", vehicle_id: "", driver_id: "",
    customer_price: "", subcontractor_id: "", subcontractor_cost: "",
    stops: [emptyStop("collection"), emptyStop("delivery")],
  });

  async function loadData() {
    setMessage("");
    const jobsQuery = supabase.from("jobs").select(`
        id, tenant_id, reference, status, scheduled_date, customer_id, vehicle_id, driver_id,
        customer_price, subcontractor_id, subcontractor_cost,
        accepted_at, accepted_by, collection_eta, delivery_eta, acceptance_note,
        customers ( name ), vehicles ( registration ), drivers ( name ),
        subcontractors ( name, vehicle_reg, driver_name ),
        job_stops ( id, stop_order, type, address_line, city, postcode, status, pod_status, recipient_name, delivered_at, pod_notes, pod_photo_url )
      `);

    const { data: jobsData, error: jobsError } = await tenant.filterByTenant(jobsQuery).order("created_at", { ascending: false });
    const { data: vehicleData, error: vehicleError } = await tenant.filterByTenant(supabase.from("vehicles").select("id, registration")).eq("active", true).order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant.filterByTenant(supabase.from("drivers").select("id, name")).eq("active", true).order("name", { ascending: true });
    const { data: customerData, error: customerError } = await tenant.filterByTenant(supabase.from("customers").select("id, name")).eq("active", true).order("name", { ascending: true });
    const { data: subcontractorData, error: subcontractorError } = await tenant.filterByTenant(supabase.from("subcontractors").select("id, name, vehicle_reg, driver_name")).eq("active", true).order("name", { ascending: true });

    if (jobsError) { setMessage(`Jobs load error: ${jobsError.message}`); return; }
    if (vehicleError) { setMessage(`Vehicles load error: ${vehicleError.message}`); return; }
    if (driverError) { setMessage(`Drivers load error: ${driverError.message}`); return; }
    if (customerError) { setMessage(`Customers load error: ${customerError.message}`); return; }
    if (subcontractorError) { setMessage(`Subcontractors load error: ${subcontractorError.message}`); return; }

    const normalizedJobs = (jobsData || []).map((job: any) => ({
      ...job,
      job_stops: [...(job.job_stops || [])].sort((a, b) => a.stop_order - b.stop_order),
    }));

    setJobs(normalizedJobs);
    setVehicles(vehicleData || []);
    setDrivers(driverData || []);
    setCustomers(customerData || []);
    setSubcontractors(subcontractorData || []);
  }

  useEffect(() => { loadData(); }, [tenant.activeTenantId]);

  function resetForm() {
    setEditingJobId(null);
    setForm({
      reference: "", scheduled_date: "", customer_id: "", vehicle_id: "", driver_id: "",
      customer_price: "", subcontractor_id: "", subcontractor_cost: "",
      stops: [emptyStop("collection"), emptyStop("delivery")],
    });
  }

  function addStop(type: "collection" | "delivery") {
    setForm((current) => ({ ...current, stops: [...current.stops, emptyStop(type)] }));
  }
  function updateStop(index: number, field: string, value: string) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => (i === index ? { ...stop, [field]: value } : stop)),
    }));
  }
  function removeStop(index: number) {
    setForm((current) => {
      const nextStops = current.stops.filter((_, i) => i !== index);
      return { ...current, stops: nextStops.length > 0 ? nextStops : [emptyStop("collection"), emptyStop("delivery")] };
    });
  }

  function startEdit(job: any) {
    setEditingJobId(job.id);
    setForm({
      reference: job.reference || "",
      scheduled_date: job.scheduled_date || "",
      customer_id: job.customer_id || "",
      vehicle_id: job.vehicle_id || "",
      driver_id: job.driver_id || "",
      customer_price: job.customer_price == null ? "" : String(job.customer_price),
      subcontractor_id: job.subcontractor_id || "",
      subcontractor_cost: job.subcontractor_cost == null ? "" : String(job.subcontractor_cost),
      stops: job.job_stops?.length
        ? job.job_stops.map((s: any) => ({ type: s.type, address_line: s.address_line || "", city: s.city || "", postcode: s.postcode || "" }))
        : [emptyStop("collection"), emptyStop("delivery")],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updatePodForm(stopId: string, field: string, value: string) {
    setPodForms((current) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name || "",
        pod_notes: current[stopId]?.pod_notes || "",
        pod_photo_url: current[stopId]?.pod_photo_url || "",
        [field]: value,
      },
    }));
  }

  async function saveJob(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant.writeTenantId) { setMessage("Pick a specific tenant to create records."); return; }

    setLoading(true);
    setMessage("");

    const validation = JobPageValidation.safeParse(form);
    if (!validation.success) {
      setLoading(false);
      setMessage(validation.error.issues[0]?.message || "Please fill in all required fields.");
      return;
    }
    const reference = validation.data.reference;

    const validStops = form.stops
      .map((stop) => ({ ...stop, address_line: stop.address_line.trim(), city: stop.city.trim(), postcode: stop.postcode.trim() }))
      .filter((stop) => stop.address_line);

    if (validStops.length === 0) { setLoading(false); setMessage("Add at least one stop."); return; }

    for (const stop of validStops) {
      const stopSchema = stop.type === "collection" ? CollectionStopValidation : DeliveryStopValidation;
      const stopValidation = stopSchema.safeParse(stop);
      if (!stopValidation.success) {
        setLoading(false);
        setMessage(stopValidation.error.issues[0]?.message || "Stop details are invalid.");
        return;
      }
    }

    const customerPrice = form.customer_price === "" ? null : Number(form.customer_price);
    const subcontractorCost = form.subcontractor_cost === "" ? null : Number(form.subcontractor_cost);

    const payload = {
      reference, scheduled_date: form.scheduled_date || null, customer_id: form.customer_id || null,
      vehicle_id: form.vehicle_id || null, driver_id: form.driver_id || null,
      customer_price: customerPrice, subcontractor_id: form.subcontractor_id || null, subcontractor_cost: subcontractorCost,
    };

    let jobId = editingJobId;

    if (editingJobId) {
      const { error: updateError } = await supabase.from("jobs").update(payload).eq("id", editingJobId);
      if (updateError) { setLoading(false); setMessage(`Update job error: ${updateError.message}`); return; }

      const { error: deleteStopsError } = await supabase.from("job_stops").delete().eq("job_id", editingJobId);
      if (deleteStopsError) { setLoading(false); setMessage(`Delete old stops error: ${deleteStopsError.message}`); return; }
    } else {
      const { data: insertedJob, error: jobError } = await supabase
        .from("jobs")
        .insert([{ ...payload, tenant_id: tenant.writeTenantId, status: "planned" }])
        .select("id")
        .single();
      if (jobError) { setLoading(false); setMessage(`Create job error: ${jobError.message}`); return; }
      jobId = insertedJob.id;
    }

    const stopsToInsert = validStops.map((stop, index) => ({
      tenant_id: tenant.writeTenantId, job_id: jobId, stop_order: index + 1, type: stop.type,
      address_line: stop.address_line, city: stop.city || null, postcode: stop.postcode || null,
      planned_at: form.scheduled_date ? `${form.scheduled_date}T08:00:00` : null,
      status: "planned", pod_status: "pending",
    }));

    const { error: stopsError } = await supabase.from("job_stops").insert(stopsToInsert);
    setLoading(false);
    if (stopsError) { setMessage(`Stops error: ${stopsError.message}`); return; }

    setMessage(editingJobId ? "Job updated." : "Job created.");
    resetForm();
    await loadData();
  }

  async function performDelete(jobId: string) {
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    if (error) { setMessage(`Delete job error: ${error.message}`); return; }
    if (editingJobId === jobId) resetForm();
    setMessage("Job deleted.");
    await loadData();
  }

  function requestDelete(job: any) {
    if (job.status !== "planned") { setMessage("Only planned jobs can be deleted right now."); return; }
    setDeleteTarget({ id: job.id, reference: job.reference });
  }

  function openAcceptance(job: any) {
    setMessage("");

    setAcceptanceTarget({
      id: job.id,
      tenant_id: job.tenant_id,
      reference: job.reference,
    });

    setAcceptanceForm({
      collection_eta: "",
      delivery_eta: "",
      acceptance_note: "",
    });
  }

  function cancelAcceptance() {
    if (accepting) {
      return;
    }

    setAcceptanceTarget(null);

    setAcceptanceForm({
      collection_eta: "",
      delivery_eta: "",
      acceptance_note: "",
    });
  }

  async function confirmAcceptance() {
    if (!acceptanceTarget || accepting) {
      return;
    }

    setMessage("");

    if (!acceptanceForm.collection_eta) {
      setMessage("Enter a collection ETA before accepting the job.");
      return;
    }

    const collectionDate = new Date(
      acceptanceForm.collection_eta
    );

    if (Number.isNaN(collectionDate.getTime())) {
      setMessage("Enter a valid collection ETA.");
      return;
    }

    let deliveryDate: Date | null = null;

    if (acceptanceForm.delivery_eta) {
      deliveryDate = new Date(
        acceptanceForm.delivery_eta
      );

      if (Number.isNaN(deliveryDate.getTime())) {
        setMessage("Enter a valid delivery ETA.");
        return;
      }

      if (
        deliveryDate.getTime() <
        collectionDate.getTime()
      ) {
        setMessage(
          "Delivery ETA cannot be earlier than collection ETA."
        );
        return;
      }
    }

    setAccepting(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setMessage(
          "Your session has expired. Please sign in again."
        );
        return;
      }

      const {
        data: acceptedJob,
        error: acceptanceError,
      } = await supabase
        .from("jobs")
        .update({
          status: "planned",
          accepted_at: new Date().toISOString(),
          accepted_by: user.id,
          collection_eta: collectionDate.toISOString(),
          delivery_eta: deliveryDate
            ? deliveryDate.toISOString()
            : null,
          acceptance_note:
            acceptanceForm.acceptance_note.trim() ||
            null,
        })
        .eq("id", acceptanceTarget.id)
        .eq(
          "tenant_id",
          acceptanceTarget.tenant_id
        )
        .eq(
          "status",
          "pending_acceptance"
        )
        .select("id")
        .maybeSingle();

      if (acceptanceError) {
        setMessage(
          `Accept job error: ${acceptanceError.message}`
        );
        return;
      }

      if (!acceptedJob) {
        setMessage(
          "This job has already been accepted or is no longer awaiting acceptance."
        );

        setAcceptanceTarget(null);
        await loadData();
        return;
      }

      setMessage(
        `Job ${acceptanceTarget.reference} accepted.`
      );

      setAcceptanceTarget(null);

      setAcceptanceForm({
        collection_eta: "",
        delivery_eta: "",
        acceptance_note: "",
      });

      await loadData();
    } finally {
      setAccepting(false);
    }
  }

  async function savePod(jobId: string, stopId: string) {
    const podForm = podForms[stopId] || { recipient_name: "", pod_notes: "", pod_photo_url: "" };
    const updatePayload: Record<string, any> = {
      recipient_name: podForm.recipient_name.trim() || null,
      pod_notes: podForm.pod_notes.trim() || null,
      delivered_at: new Date().toISOString(),
      pod_status: "delivered",
      status: "completed",
    };
    if (podForm.pod_photo_url.trim()) updatePayload.pod_photo_url = podForm.pod_photo_url.trim();

    const { error: stopError } = await supabase.from("job_stops").update(updatePayload).eq("id", stopId);
    if (stopError) { setMessage(`POD save error: ${stopError.message}`); return; }

    const { data: deliveryStops, error: deliveryStopsError } = await supabase
      .from("job_stops").select("id, pod_status, type").eq("job_id", jobId).eq("type", "delivery");
    if (deliveryStopsError) { setMessage(`Delivery stop check error: ${deliveryStopsError.message}`); await loadData(); return; }

    const allDelivered = (deliveryStops || []).length > 0 && deliveryStops.every((s: any) => s.pod_status === "delivered");
    if (allDelivered) {
      const { error: jobUpdateError } = await supabase.from("jobs").update({ status: "completed" }).eq("id", jobId);
      if (jobUpdateError) { setMessage(`Job completion error: ${jobUpdateError.message}`); await loadData(); return; }
    }

    setMessage("POD saved.");
    await loadData();
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
        <p className="mt-1 text-sm text-ink-2">
          Create jobs, edit jobs, delete planned jobs, and complete POD from one screen.
        </p>

        <div className="mt-6">
          <JobForm
            form={form}
            editingJobId={editingJobId}
            loading={loading}
            customers={customers.map((c) => ({ id: c.id, label: c.name }))}
            vehicles={vehicles.map((v) => ({ id: v.id, label: v.registration }))}
            drivers={drivers.map((d) => ({ id: d.id, label: d.name }))}
            subcontractors={subcontractors.map((s) => ({
              id: s.id, label: `${s.name} - ${s.vehicle_reg || "No reg"} - ${s.driver_name || "No driver"}`,
            }))}
            onFieldChange={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
            onStopChange={updateStop}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            onSubmit={saveJob}
            onCancelEdit={resetForm}
          />
        </div>

        {message ? (
          <div className="mt-5 rounded-lg border border-line bg-surface p-3.5 text-sm text-ink">{message}</div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {jobs.map((job) => {
            const margin =
              job.customer_price != null && job.subcontractor_cost != null
                ? Number(job.customer_price) - Number(job.subcontractor_cost)
                : null;

            return (
              <div key={job.id} className="rounded-lg border border-line bg-surface p-5 shadow-sm">
                <div className="mb-3.5 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-mono text-lg font-semibold text-ink">{job.reference}</h2>
                    <div className="text-sm text-ink-2">
                      Date: {job.scheduled_date || "-"} · Status:{" "}
                      {job.status === "pending_acceptance"
                        ? "Awaiting acceptance"
                        : job.status}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.status === "pending_acceptance" ? (
                      <Button
                        type="button"
                        onClick={() => openAcceptance(job)}
                      >
                        Accept Job
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => startEdit(job)}
                    >
                      Edit
                    </Button>

                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => requestDelete(job)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {acceptanceTarget?.id === job.id ? (
                  <div className="mb-4 rounded-lg border border-line bg-surface-2 p-4">
                    <div className="text-sm font-semibold text-ink">
                      Accept Job - {job.reference}
                    </div>

                    <p className="mt-1 text-xs text-ink-2">
                      Confirm the expected collection time before accepting this customer job.
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5 text-sm text-ink">
                        <span className="font-medium">
                          Collection ETA *
                        </span>

                        <input
                          type="datetime-local"
                          value={acceptanceForm.collection_eta}
                          onChange={(event) =>
                            setAcceptanceForm((current) => ({
                              ...current,
                              collection_eta:
                                event.target.value,
                            }))
                          }
                          disabled={accepting}
                          className="rounded-md border border-line-strong bg-surface px-3 py-2 text-ink"
                        />
                      </label>

                      <label className="grid gap-1.5 text-sm text-ink">
                        <span className="font-medium">
                          Delivery ETA
                        </span>

                        <input
                          type="datetime-local"
                          value={acceptanceForm.delivery_eta}
                          onChange={(event) =>
                            setAcceptanceForm((current) => ({
                              ...current,
                              delivery_eta:
                                event.target.value,
                            }))
                          }
                          disabled={accepting}
                          className="rounded-md border border-line-strong bg-surface px-3 py-2 text-ink"
                        />
                      </label>
                    </div>

                    <label className="mt-3 grid gap-1.5 text-sm text-ink">
                      <span className="font-medium">
                        Acceptance note
                      </span>

                      <textarea
                        value={acceptanceForm.acceptance_note}
                        onChange={(event) =>
                          setAcceptanceForm((current) => ({
                            ...current,
                            acceptance_note:
                              event.target.value,
                          }))
                        }
                        rows={3}
                        disabled={accepting}
                        placeholder="Optional note about collection, access or scheduling"
                        className="rounded-md border border-line-strong bg-surface px-3 py-2 text-ink"
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={cancelAcceptance}
                        disabled={accepting}
                      >
                        Cancel
                      </Button>

                      <Button
                        type="button"
                        onClick={confirmAcceptance}
                        loading={accepting}
                      >
                        Confirm Acceptance
                      </Button>
                    </div>
                  </div>
                ) : null}

                {job.accepted_at ? (
                  <div className="mb-4 rounded-lg border border-line bg-surface-2 p-4">
                    <div className="text-sm font-semibold text-ink">
                      Accepted
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold text-ink-3">
                          Collection ETA
                        </div>
                        <div className="text-sm text-ink">
                          {formatDateTime(job.collection_eta)}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-ink-3">
                          Delivery ETA
                        </div>
                        <div className="text-sm text-ink">
                          {formatDateTime(job.delivery_eta)}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-ink-3">
                          Accepted at
                        </div>
                        <div className="text-sm text-ink">
                          {formatDateTime(job.accepted_at)}
                        </div>
                      </div>
                    </div>

                    {job.acceptance_note ? (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-ink-3">
                          Acceptance note
                        </div>

                        <div className="mt-1 whitespace-pre-wrap text-sm text-ink">
                          {job.acceptance_note}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Customer</div>
                    <div className="text-sm text-ink">{job.customers?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Vehicle</div>
                    <div className="font-mono text-sm text-ink">{job.vehicles?.registration || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Driver</div>
                    <div className="text-sm text-ink">{job.drivers?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Sell</div>
                    <div className="font-mono text-sm slashed-zero text-ink">{formatMoney(job.customer_price)}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Subcontractor</div>
                    <div className="text-sm text-ink">{job.subcontractors?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Buy</div>
                    <div className="font-mono text-sm slashed-zero text-ink">{formatMoney(job.subcontractor_cost)}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Margin</div>
                    <div className="font-mono text-sm slashed-zero text-ink">{formatMoney(margin)}</div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Stops / POD</h3>
                  {job.job_stops?.length ? (
                    <div className="grid gap-2.5">
                      {job.job_stops.map((stop: any) => (
                        <StopCard
                          key={stop.id}
                          stop={stop}
                          podForm={podForms[stop.id]}
                          onPodFieldChange={updatePodForm}
                          onMarkDelivered={(stopId) => savePod(job.id, stopId)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-ink-3">No stops yet.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <DeleteJobDialog
        open={!!deleteTarget}
        jobReference={deleteTarget?.reference ?? ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) performDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
      </div>
    </TenantGate>
  );
}
