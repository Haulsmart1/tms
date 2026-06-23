"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

const emptyStop = (type: any) => ({
  type,
  address_line: "",
  city: "",
  postcode: ""
});

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(Number(value));
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "white",
  minWidth: 160,
  boxSizing: "border-box"
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer"
};

const secondaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827",
  fontWeight: 600,
  cursor: "pointer"
};

const deleteButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "white",
  fontWeight: 600,
  cursor: "pointer"
};

export default function JobsPage() {
  const supabase = createClient();

  const [jobs, setJobs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingJobId, setEditingJobId] = useState(null);
  const [podForms, setPodForms] = useState<Record<string, any>>({});

  const [form, setForm] = useState({
    reference: "",
    scheduled_date: "",
    customer_id: "",
    vehicle_id: "",
    driver_id: "",
    customer_price: "",
    subcontractor_id: "",
    subcontractor_cost: "",
    stops: [emptyStop("collection"), emptyStop("delivery")]
  });

  async function loadData() {
    setMessage("");

    const { data: jobsData, error: jobsError } = await supabase
      .from("jobs")
      .select(`
        id,
        reference,
        status,
        scheduled_date,
        customer_id,
        vehicle_id,
        driver_id,
        customer_price,
        subcontractor_id,
        subcontractor_cost,
        customers (
          name
        ),
        vehicles (
          registration
        ),
        drivers (
          name
        ),
        subcontractors (
          name,
          vehicle_reg,
          driver_name
        ),
        job_stops (
          id,
          stop_order,
          type,
          address_line,
          city,
          postcode,
          status,
          pod_status,
          recipient_name,
          delivered_at,
          pod_notes,
          pod_photo_url
        )
      `)
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    const { data: vehicleData, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, registration")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true)
      .order("registration", { ascending: true });

    const { data: driverData, error: driverError } = await supabase
      .from("drivers")
      .select("id, name")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true)
      .order("name", { ascending: true });

    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("id, name")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true)
      .order("name", { ascending: true });

    const { data: subcontractorData, error: subcontractorError } = await supabase
      .from("subcontractors")
      .select("id, name, vehicle_reg, driver_name")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true)
      .order("name", { ascending: true });

    if (jobsError) {
      setMessage(`Jobs load error: ${jobsError.message}`);
      return;
    }

    if (vehicleError) {
      setMessage(`Vehicles load error: ${vehicleError.message}`);
      return;
    }

    if (driverError) {
      setMessage(`Drivers load error: ${driverError.message}`);
      return;
    }

    if (customerError) {
      setMessage(`Customers load error: ${customerError.message}`);
      return;
    }

    if (subcontractorError) {
      setMessage(`Subcontractors load error: ${subcontractorError.message}`);
      return;
    }

    const normalizedJobs = (jobsData || []).map((job: any) => ({
      ...job,
      job_stops: [...(job.job_stops || [])].sort(
        (a, b) => a.stop_order - b.stop_order
      )
    }));

    setJobs(normalizedJobs);
    setVehicles(vehicleData || []);
    setDrivers(driverData || []);
    setCustomers(customerData || []);
    setSubcontractors(subcontractorData || []);
  }

  useEffect(() => {
    loadData();
  }, []);

  function resetForm() {
    setEditingJobId(null);
    setForm({
      reference: "",
      scheduled_date: "",
      customer_id: "",
      vehicle_id: "",
      driver_id: "",
      customer_price: "",
      subcontractor_id: "",
      subcontractor_cost: "",
      stops: [emptyStop("collection"), emptyStop("delivery")]
    });
  }

  function addStop(type: any) {
    setForm((current: any) => ({
      ...current,
      stops: [...current.stops, emptyStop(type)]
    }));
  }

  function updateStop(index: any, field: any, value: any) {
    setForm((current: any) => ({
      ...current,
      stops: current.stops.map((stop: any, stopIndex: any) =>
        stopIndex === index ? { ...stop, [field]: value } : stop
      )
    }));
  }

  function removeStop(index: any) {
    setForm((current: any) => {
      const nextStops = current.stops.filter((_: any, stopIndex: any) => stopIndex !== index);

      return {
        ...current,
        stops: nextStops.length > 0 ? nextStops : [emptyStop("collection"), emptyStop("delivery")]
      };
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
      customer_price:
        job.customer_price === null || job.customer_price === undefined
          ? ""
          : String(job.customer_price),
      subcontractor_id: job.subcontractor_id || "",
      subcontractor_cost:
        job.subcontractor_cost === null || job.subcontractor_cost === undefined
          ? ""
          : String(job.subcontractor_cost),
      stops:
        job.job_stops && job.job_stops.length > 0
          ? job.job_stops.map((stop: any) => ({
            type: stop.type,
            address_line: stop.address_line || "",
            city: stop.city || "",
            postcode: stop.postcode || ""
          }))
          : [emptyStop("collection"), emptyStop("delivery")]
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updatePodForm(stopId: any, field: any, value: any) {
    setPodForms((current: any) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name || "",
        pod_notes: current[stopId]?.pod_notes || "",
        pod_photo_url: current[stopId]?.pod_photo_url || "",
        [field]: value
      }
    }));
  }

  async function saveJob(event: any) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const reference = form.reference.trim();

    if (!reference) {
      setLoading(false);
      setMessage("Reference is required.");
      return;
    }

    const validStops = form.stops
      .map((stop: any) => ({
        ...stop,
        address_line: stop.address_line.trim(),
        city: stop.city.trim(),
        postcode: stop.postcode.trim()
      }))
      .filter((stop: any) => stop.address_line);

    if (validStops.length === 0) {
      setLoading(false);
      setMessage("Add at least one stop.");
      return;
    }

    const customerPrice =
      form.customer_price === "" ? null : Number(form.customer_price);

    const subcontractorCost =
      form.subcontractor_cost === "" ? null : Number(form.subcontractor_cost);

    const payload = {
      tenant_id: TENANT_ID,
      reference,
      scheduled_date: form.scheduled_date || null,
      customer_id: form.customer_id || null,
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      customer_price: customerPrice,
      subcontractor_id: form.subcontractor_id || null,
      subcontractor_cost: subcontractorCost
    };

    let jobId = editingJobId;

    if (editingJobId) {
      const { error: updateError } = await supabase
        .from("jobs")
        .update(payload)
        .eq("id", editingJobId)
        .eq("tenant_id", TENANT_ID);

      if (updateError) {
        setLoading(false);
        setMessage(`Update job error: ${updateError.message}`);
        return;
      }

      const { error: deleteStopsError } = await supabase
        .from("job_stops")
        .delete()
        .eq("job_id", editingJobId)
        .eq("tenant_id", TENANT_ID);

      if (deleteStopsError) {
        setLoading(false);
        setMessage(`Delete old stops error: ${deleteStopsError.message}`);
        return;
      }
    } else {
      const { data: insertedJob, error: jobError } = await supabase
        .from("jobs")
        .insert([
          {
            ...payload,
            status: "planned"
          }
        ])
        .select("id")
        .single();

      if (jobError) {
        setLoading(false);
        setMessage(`Create job error: ${jobError.message}`);
        return;
      }

      jobId = insertedJob.id;
    }

    const stopsToInsert = validStops.map((stop, index) => ({
      tenant_id: TENANT_ID,
      job_id: jobId,
      stop_order: index + 1,
      type: stop.type,
      address_line: stop.address_line,
      city: stop.city || null,
      postcode: stop.postcode || null,
      planned_at: form.scheduled_date ? `${form.scheduled_date}T08:00:00` : null,
      status: "planned",
      pod_status: "pending"
    }));

    const { error: stopsError } = await supabase
      .from("job_stops")
      .insert(stopsToInsert);

    setLoading(false);

    if (stopsError) {
      setMessage(`Stops error: ${stopsError.message}`);
      return;
    }

    setMessage(editingJobId ? "Job updated." : "Job created.");
    resetForm();
    await loadData();
  }

  async function deleteJob(jobId: any, jobStatus: any) {
    if (jobStatus !== "planned") {
      setMessage("Only planned jobs can be deleted right now.");
      return;
    }

    const confirmed = window.confirm(
      "Delete this job and all linked stops?"
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("id", jobId)
      .eq("tenant_id", TENANT_ID);

    if (error) {
      setMessage(`Delete job error: ${error.message}`);
      return;
    }

    if (editingJobId === jobId) {
      resetForm();
    }

    setMessage("Job deleted.");
    await loadData();
  }

  async function savePod(jobId: any, stopId: any) {
    const podForm = podForms[stopId] || {
      recipient_name: "",
      pod_notes: "",
      pod_photo_url: ""
    };

    const { error: stopError } = await supabase
      .from("job_stops")
      .update({
        recipient_name: podForm.recipient_name.trim() || null,
        pod_notes: podForm.pod_notes.trim() || null,
        pod_photo_url: podForm.pod_photo_url.trim() || null,
        delivered_at: new Date().toISOString(),
        pod_status: "delivered",
        status: "completed"
      })
      .eq("id", stopId)
      .eq("tenant_id", TENANT_ID);

    if (stopError) {
      setMessage(`POD save error: ${stopError.message}`);
      return;
    }

    const { data: deliveryStops, error: deliveryStopsError } = await supabase
      .from("job_stops")
      .select("id, pod_status, type")
      .eq("tenant_id", TENANT_ID)
      .eq("job_id", jobId)
      .eq("type", "delivery");

    if (deliveryStopsError) {
      setMessage(`Delivery stop check error: ${deliveryStopsError.message}`);
      await loadData();
      return;
    }

    const allDelivered =
      (deliveryStops || []).length > 0 &&
      deliveryStops.every((stop: any) => stop.pod_status === "delivered");

    if (allDelivered) {
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ status: "completed" })
        .eq("id", jobId)
        .eq("tenant_id", TENANT_ID);

      if (jobUpdateError) {
        setMessage(`Job completion error: ${jobUpdateError.message}`);
        await loadData();
        return;
      }
    }

    setMessage("POD saved.");
    await loadData();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.60)",
          padding: 30,
          borderRadius: 20
        }}
      >
        <div style={{ color: "white", marginBottom: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 38 }}>Jobs</h1>
          <p style={{ opacity: 0.85, marginBottom: 0 }}>
            Create jobs, edit jobs, delete planned jobs, and complete POD from one screen.
          </p>
        </div>

        <form
          onSubmit={saveJob}
          style={{
            display: "grid",
            gap: 16,
            marginBottom: 24,
            maxWidth: 1100,
            background: "rgba(255,255,255,0.95)",
            padding: 24,
            borderRadius: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)"
          }}
        >
          <h2 style={{ margin: 0 }}>
            {editingJobId ? "Edit Job" : "Create Job"}
          </h2>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={inputStyle}
              placeholder="Reference"
              value={form.reference}
              onChange={(e: any) =>
                setForm({ ...form, reference: e.target.value })
              }
            />

            <input
              style={inputStyle}
              type="date"
              value={form.scheduled_date}
              onChange={(e: any) =>
                setForm({ ...form, scheduled_date: e.target.value })
              }
            />

            <select
              style={inputStyle}
              value={form.customer_id}
              onChange={(e: any) =>
                setForm({ ...form, customer_id: e.target.value })
              }
            >
              <option value="">Select customer</option>
              {customers.map((customer: any) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>

            <select
              style={inputStyle}
              value={form.vehicle_id}
              onChange={(e: any) =>
                setForm({ ...form, vehicle_id: e.target.value })
              }
            >
              <option value="">Select vehicle</option>
              {vehicles.map((vehicle: any) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration}
                </option>
              ))}
            </select>

            <select
              style={inputStyle}
              value={form.driver_id}
              onChange={(e: any) =>
                setForm({ ...form, driver_id: e.target.value })
              }
            >
              <option value="">Select driver</option>
              {drivers.map((driver: any) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={inputStyle}
              type="number"
              step="0.01"
              placeholder="Customer price"
              value={form.customer_price}
              onChange={(e: any) =>
                setForm({ ...form, customer_price: e.target.value })
              }
            />

            <select
              style={inputStyle}
              value={form.subcontractor_id}
              onChange={(e: any) =>
                setForm({ ...form, subcontractor_id: e.target.value })
              }
            >
              <option value="">Select subcontractor</option>
              {subcontractors.map((subcontractor: any) => (
                <option key={subcontractor.id} value={subcontractor.id}>
                  {subcontractor.name} - {subcontractor.vehicle_reg || "No Reg"} - {subcontractor.driver_name || "No Driver"}
                </option>
              ))}
            </select>

            <input
              style={inputStyle}
              type="number"
              step="0.01"
              placeholder="Subcontractor cost"
              value={form.subcontractor_cost}
              onChange={(e: any) =>
                setForm({ ...form, subcontractor_cost: e.target.value })
              }
            />
          </div>

          <div>
            <h3 style={{ margin: "6px 0 10px 0" }}>Collection Stops</h3>
            {form.stops.map((stop, index) =>
              stop.type === "collection" ? (
                <div
                  key={`collection-${index}`}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
                >
                  <input
                    style={inputStyle}
                    placeholder="Collection address"
                    value={stop.address_line}
                    onChange={(e: any) =>
                      updateStop(index, "address_line", e.target.value)
                    }
                  />
                  <input
                    style={inputStyle}
                    placeholder="City"
                    value={stop.city}
                    onChange={(e: any) => updateStop(index, "city", e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Postcode"
                    value={stop.postcode}
                    onChange={(e: any) =>
                      updateStop(index, "postcode", e.target.value)
                    }
                  />
                  <button type="button" style={secondaryButtonStyle} onClick={() => removeStop(index)}>
                    Remove
                  </button>
                </div>
              ) : null
            )}
            <button type="button" style={secondaryButtonStyle} onClick={() => addStop("collection")}>
              + Add Collection Stop
            </button>
          </div>

          <div>
            <h3 style={{ margin: "6px 0 10px 0" }}>Delivery Stops</h3>
            {form.stops.map((stop, index) =>
              stop.type === "delivery" ? (
                <div
                  key={`delivery-${index}`}
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}
                >
                  <input
                    style={inputStyle}
                    placeholder="Delivery address"
                    value={stop.address_line}
                    onChange={(e: any) =>
                      updateStop(index, "address_line", e.target.value)
                    }
                  />
                  <input
                    style={inputStyle}
                    placeholder="City"
                    value={stop.city}
                    onChange={(e: any) => updateStop(index, "city", e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Postcode"
                    value={stop.postcode}
                    onChange={(e: any) =>
                      updateStop(index, "postcode", e.target.value)
                    }
                  />
                  <button type="button" style={secondaryButtonStyle} onClick={() => removeStop(index)}>
                    Remove
                  </button>
                </div>
              ) : null
            )}
            <button type="button" style={secondaryButtonStyle} onClick={() => addStop("delivery")}>
              + Add Delivery Stop
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle} disabled={loading}>
              {loading ? "Saving..." : editingJobId ? "Update Job" : "Add Job"}
            </button>

            {editingJobId ? (
              <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
                Cancel Edit
              </button>
            ) : null}
          </div>
        </form>

        {message ? (
          <div
            style={{
              marginBottom: 20,
              background: "rgba(255,255,255,0.94)",
              padding: 14,
              borderRadius: 12,
              color: "#111827"
            }}
          >
            {message}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 18 }}>
          {jobs.map((job: any) => {
            const margin =
              job.customer_price != null && job.subcontractor_cost != null
                ? Number(job.customer_price) - Number(job.subcontractor_cost)
                : null;

            return (
              <div
                key={job.id}
                style={{
                  background: "rgba(255,255,255,0.95)",
                  padding: 22,
                  borderRadius: 16,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.18)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 20,
                    flexWrap: "wrap",
                    marginBottom: 14
                  }}
                >
                  <div>
                    <h2 style={{ margin: "0 0 8px 0" }}>{job.reference}</h2>
                    <div style={{ color: "#4b5563" }}>
                      Date: {job.scheduled_date || "-"} | Status: {job.status}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() => startEdit(job)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      style={deleteButtonStyle}
                      onClick={() => deleteJob(job.id, job.status)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    marginBottom: 18
                  }}
                >
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Customer</strong>
                    <div>{job.customers?.name || "-"}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Vehicle</strong>
                    <div>{job.vehicles?.registration || "-"}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Driver</strong>
                    <div>{job.drivers?.name || "-"}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Sell</strong>
                    <div>{formatMoney(job.customer_price)}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Subcontractor</strong>
                    <div>{job.subcontractors?.name || "-"}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Buy</strong>
                    <div>{formatMoney(job.subcontractor_cost)}</div>
                  </div>
                  <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                    <strong>Margin</strong>
                    <div>{formatMoney(margin)}</div>
                  </div>
                </div>

                <div>
                  <h3 style={{ marginBottom: 10 }}>Stops / POD</h3>

                  {job.job_stops?.length ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {job.job_stops.map((stop: any) => (
                        <div
                          key={stop.id}
                          style={{
                            border: "1px solid #e5e7eb",
                            padding: 14,
                            borderRadius: 12,
                            background: "#f9fafb"
                          }}
                        >
                          <div>
                            <strong>
                              {stop.stop_order}. {stop.type}
                            </strong>{" "}
                            - {stop.address_line}
                            {stop.city ? `, ${stop.city}` : ""}
                            {stop.postcode ? `, ${stop.postcode}` : ""}
                          </div>

                          <div style={{ marginTop: 6, color: "#4b5563" }}>
                            Stop status: {stop.status || "-"} | POD: {stop.pod_status || "pending"}
                          </div>

                          {stop.delivered_at ? (
                            <div style={{ marginTop: 6, color: "#4b5563" }}>
                              Delivered at: {new Date(stop.delivered_at).toLocaleString("en-GB")}
                            </div>
                          ) : null}

                          {stop.recipient_name ? (
                            <div style={{ marginTop: 6 }}>
                              Recipient: {stop.recipient_name}
                            </div>
                          ) : null}

                          {stop.pod_notes ? (
                            <div style={{ marginTop: 6 }}>
                              Notes: {stop.pod_notes}
                            </div>
                          ) : null}

                          {stop.pod_photo_url ? (
                            <div style={{ marginTop: 6 }}>
                              Photo:{" "}
                              <a
                                href={stop.pod_photo_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#111827", fontWeight: 600 }}
                              >
                                View POD
                              </a>
                            </div>
                          ) : null}

                          {stop.type === "delivery" && stop.pod_status !== "delivered" ? (
                            <div style={{ display: "grid", gap: 10, marginTop: 12, maxWidth: 720 }}>
                              <input
                                style={inputStyle}
                                placeholder="Recipient name"
                                value={podForms[stop.id]?.recipient_name || ""}
                                onChange={(e: any) =>
                                  updatePodForm(stop.id, "recipient_name", e.target.value)
                                }
                              />
                              <input
                                style={inputStyle}
                                placeholder="POD photo URL"
                                value={podForms[stop.id]?.pod_photo_url || ""}
                                onChange={(e: any) =>
                                  updatePodForm(stop.id, "pod_photo_url", e.target.value)
                                }
                              />
                              <input
                                style={inputStyle}
                                placeholder="POD notes"
                                value={podForms[stop.id]?.pod_notes || ""}
                                onChange={(e: any) =>
                                  updatePodForm(stop.id, "pod_notes", e.target.value)
                                }
                              />
                              <div>
                                <button
                                  type="button"
                                  style={buttonStyle}
                                  onClick={() => savePod(job.id, stop.id)}
                                >
                                  Mark Delivered
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>No stops yet.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}










