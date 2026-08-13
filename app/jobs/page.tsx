"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";

type JobStatus =
  | "draft"
  | "booked"
  | "planned"
  | "allocated"
  | "collecting"
  | "collected"
  | "in_transit"
  | "delivered"
  | "completed"
  | "invoiced"
  | "cancelled";

type Customer = {
  id: string;
  name: string;
};

type Vehicle = {
  id: string;
  registration?: string | null;
  registration_number?: string | null;
  reg?: string | null;
};

type Driver = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
};

type Subcontractor = {
  id: string;
  name: string;
};

type Job = {
  id: string;
  tenant_id: string;
  reference: string;
  customer_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  subcontractor_id: string | null;
  status: JobStatus;
  job_date: string | null;
  customer_reference?: string | null;
  customer_price: number | null;
  subcontractor_cost: number | null;
  notes: string | null;
  created_at?: string;
};

type Stop = {
  id?: string;
  job_id?: string;
  stop_type: "collection" | "delivery";
  sequence: number;
  company_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  contact_name: string;
  phone: string;
  planned_date: string;
  planned_time: string;
  instructions: string;
};

type JobForm = {
  reference: string;
  customer_reference: string;
  customer_id: string;
  vehicle_id: string;
  driver_id: string;
  subcontractor_id: string;
  status: JobStatus;
  job_date: string;
  customer_price: string;
  subcontractor_cost: string;
  notes: string;
};

const EMPTY_STOP: Stop = {
  stop_type: "collection",
  sequence: 1,
  company_name: "",
  address_line1: "",
  address_line2: "",
  city: "",
  postcode: "",
  contact_name: "",
  phone: "",
  planned_date: "",
  planned_time: "",
  instructions: "",
};

const EMPTY_FORM: JobForm = {
  reference: "",
  customer_reference: "",
  customer_id: "",
  vehicle_id: "",
  driver_id: "",
  subcontractor_id: "",
  status: "booked",
  job_date: new Date().toISOString().slice(0, 10),
  customer_price: "",
  subcontractor_cost: "",
  notes: "",
};

const STATUS_OPTIONS: JobStatus[] = [
  "draft",
  "booked",
  "planned",
  "allocated",
  "collecting",
  "collected",
  "in_transit",
  "delivered",
  "completed",
  "invoiced",
  "cancelled",
];

export default function JobsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tenantId, setTenantId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);

  const [form, setForm] = useState<JobForm>(EMPTY_FORM);

  const [collectionStops, setCollectionStops] = useState<Stop[]>([
    { ...EMPTY_STOP, stop_type: "collection", sequence: 1 },
  ]);

  const [deliveryStops, setDeliveryStops] = useState<Stop[]>([
    { ...EMPTY_STOP, stop_type: "delivery", sequence: 1 },
  ]);

  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const getAuthenticatedTenant = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      window.location.href = "/";
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw profileError;
    }

    if (!profile?.tenant_id) {
      throw new Error(
        "Your user account is not linked to a TMS Wizzard tenant."
      );
    }

    return profile.tenant_id as string;
  }, [supabase]);

  const loadData = useCallback(
    async (resolvedTenantId: string) => {
      setLoading(true);
      setMessage("");

      try {
        const [
          jobsResult,
          customersResult,
          vehiclesResult,
          driversResult,
          subcontractorsResult,
        ] = await Promise.all([
          supabase
            .from("jobs")
            .select("*")
            .eq("tenant_id", resolvedTenantId)
            .order("created_at", { ascending: false }),

          supabase
            .from("customers")
            .select("*")
            .eq("tenant_id", resolvedTenantId)
            .order("name"),

          supabase
            .from("vehicles")
            .select("*")
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("drivers")
            .select("*")
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("subcontractors")
            .select("*")
            .eq("tenant_id", resolvedTenantId)
            .order("name"),
        ]);

        const firstError =
          jobsResult.error ||
          customersResult.error ||
          vehiclesResult.error ||
          driversResult.error ||
          subcontractorsResult.error;

        if (firstError) {
          throw firstError;
        }

        setJobs((jobsResult.data ?? []) as Job[]);
        setCustomers((customersResult.data ?? []) as Customer[]);
        setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
        setDrivers((driversResult.data ?? []) as Driver[]);
        setSubcontractors(
          (subcontractorsResult.data ?? []) as Subcontractor[]
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Unable to load jobs."
        );
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    async function initialise() {
      try {
        const resolvedTenantId = await getAuthenticatedTenant();

        if (!resolvedTenantId) {
          return;
        }

        setTenantId(resolvedTenantId);
        await loadData(resolvedTenantId);
      } catch (error) {
        setLoading(false);
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialise the jobs page."
        );
      }
    }

    void initialise();
  }, [getAuthenticatedTenant, loadData]);

  function updateForm<K extends keyof JobForm>(
    field: K,
    value: JobForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateStop(
    type: "collection" | "delivery",
    index: number,
    field: keyof Stop,
    value: string | number
  ) {
    const setter =
      type === "collection" ? setCollectionStops : setDeliveryStops;

    setter((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index
          ? {
              ...stop,
              [field]: value,
            }
          : stop
      )
    );
  }

  function addStop(type: "collection" | "delivery") {
    const setter =
      type === "collection" ? setCollectionStops : setDeliveryStops;

    setter((current) => [
      ...current,
      {
        ...EMPTY_STOP,
        stop_type: type,
        sequence: current.length + 1,
      },
    ]);
  }

  function removeStop(type: "collection" | "delivery", index: number) {
    const setter =
      type === "collection" ? setCollectionStops : setDeliveryStops;

    setter((current) => {
      if (current.length === 1) {
        return current;
      }

      return current
        .filter((_, stopIndex) => stopIndex !== index)
        .map((stop, stopIndex) => ({
          ...stop,
          sequence: stopIndex + 1,
        }));
    });
  }

  function resetForm() {
    setEditingJobId(null);
    setForm({
      ...EMPTY_FORM,
      job_date: new Date().toISOString().slice(0, 10),
    });

    setCollectionStops([
      {
        ...EMPTY_STOP,
        stop_type: "collection",
        sequence: 1,
      },
    ]);

    setDeliveryStops([
      {
        ...EMPTY_STOP,
        stop_type: "delivery",
        sequence: 1,
      },
    ]);
  }

  async function saveStops(jobId: string) {
    const stops = [...collectionStops, ...deliveryStops].map((stop) => ({
      tenant_id: tenantId,
      job_id: jobId,
      stop_type: stop.stop_type,
      sequence: stop.sequence,
      company_name: stop.company_name || null,
      address_line1: stop.address_line1 || null,
      address_line2: stop.address_line2 || null,
      city: stop.city || null,
      postcode: stop.postcode || null,
      contact_name: stop.contact_name || null,
      phone: stop.phone || null,
      planned_date: stop.planned_date || null,
      planned_time: stop.planned_time || null,
      instructions: stop.instructions || null,
    }));

    if (editingJobId) {
      const { error: deleteStopsError } = await supabase
        .from("job_stops")
        .delete()
        .eq("job_id", jobId)
        .eq("tenant_id", tenantId);

      if (deleteStopsError) {
        throw deleteStopsError;
      }
    }

    const { error } = await supabase.from("job_stops").insert(stops);

    if (error) {
      throw error;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenantId) {
      setMessage("No tenant is available for this user.");
      return;
    }

    if (!form.reference.trim()) {
      setMessage("Please enter a job reference.");
      return;
    }

    if (!form.customer_id) {
      setMessage("Please select a customer.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const payload = {
        tenant_id: tenantId,
        reference: form.reference.trim(),
        customer_reference: form.customer_reference.trim() || null,
        customer_id: form.customer_id || null,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        subcontractor_id: form.subcontractor_id || null,
        status: form.status,
        job_date: form.job_date || null,
        customer_price: form.customer_price
          ? Number(form.customer_price)
          : null,
        subcontractor_cost: form.subcontractor_cost
          ? Number(form.subcontractor_cost)
          : null,
        notes: form.notes.trim() || null,
      };

      let jobId = editingJobId;

      if (editingJobId) {
        const { error } = await supabase
          .from("jobs")
          .update(payload)
          .eq("id", editingJobId)
          .eq("tenant_id", tenantId);

        if (error) {
          throw error;
        }
      } else {
        const { data, error } = await supabase
          .from("jobs")
          .insert(payload)
          .select("id")
          .single();

        if (error) {
          throw error;
        }

        jobId = data.id;
      }

      if (!jobId) {
        throw new Error("Unable to determine the saved job ID.");
      }

      await saveStops(jobId);

      setMessage(editingJobId ? "Job updated." : "Job created.");
      resetForm();
      await loadData(tenantId);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save job."
      );
    } finally {
      setSaving(false);
    }
  }

  async function editJob(job: Job) {
    if (!tenantId) {
      return;
    }

    setMessage("");
    setEditingJobId(job.id);

    setForm({
      reference: job.reference ?? "",
      customer_reference: job.customer_reference ?? "",
      customer_id: job.customer_id ?? "",
      vehicle_id: job.vehicle_id ?? "",
      driver_id: job.driver_id ?? "",
      subcontractor_id: job.subcontractor_id ?? "",
      status: job.status ?? "booked",
      job_date: job.job_date ?? "",
      customer_price:
        job.customer_price === null ? "" : String(job.customer_price),
      subcontractor_cost:
        job.subcontractor_cost === null
          ? ""
          : String(job.subcontractor_cost),
      notes: job.notes ?? "",
    });

    const { data, error } = await supabase
      .from("job_stops")
      .select("*")
      .eq("job_id", job.id)
      .eq("tenant_id", tenantId)
      .order("sequence");

    if (error) {
      setMessage(error.message);
      return;
    }

    const stops = (data ?? []) as Stop[];

    const collections = stops.filter(
      (stop) => stop.stop_type === "collection"
    );

    const deliveries = stops.filter(
      (stop) => stop.stop_type === "delivery"
    );

    setCollectionStops(
      collections.length
        ? collections
        : [{ ...EMPTY_STOP, stop_type: "collection", sequence: 1 }]
    );

    setDeliveryStops(
      deliveries.length
        ? deliveries
        : [{ ...EMPTY_STOP, stop_type: "delivery", sequence: 1 }]
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function deleteJob(job: Job) {
    if (!tenantId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete job ${job.reference}? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const { error: stopError } = await supabase
        .from("job_stops")
        .delete()
        .eq("job_id", job.id)
        .eq("tenant_id", tenantId);

      if (stopError) {
        throw stopError;
      }

      const { error: jobError } = await supabase
        .from("jobs")
        .delete()
        .eq("id", job.id)
        .eq("tenant_id", tenantId);

      if (jobError) {
        throw jobError;
      }

      setMessage(`Job ${job.reference} deleted.`);
      await loadData(tenantId);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to delete job."
      );
    }
  }

  function customerName(customerId: string | null) {
    return (
      customers.find((customer) => customer.id === customerId)?.name ??
      "Unassigned"
    );
  }

  function vehicleName(vehicleId: string | null) {
    const vehicle = vehicles.find((item) => item.id === vehicleId);

    if (!vehicle) {
      return "Unassigned";
    }

    return (
      vehicle.registration ??
      vehicle.registration_number ??
      vehicle.reg ??
      "Vehicle"
    );
  }

  function driverName(driverId: string | null) {
    const driver = drivers.find((item) => item.id === driverId);

    if (!driver) {
      return "Unassigned";
    }

    if (driver.name) {
      return driver.name;
    }

    return [driver.first_name, driver.last_name].filter(Boolean).join(" ");
  }

  function subcontractorName(subcontractorId: string | null) {
    return (
      subcontractors.find(
        (subcontractor) => subcontractor.id === subcontractorId
      )?.name ?? "None"
    );
  }

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return jobs;
    }

    return jobs.filter((job) => {
      return [
        job.reference,
        job.customer_reference,
        customerName(job.customer_id),
        vehicleName(job.vehicle_id),
        driverName(job.driver_id),
        job.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [jobs, search, customers, vehicles, drivers]);

  const revenueTotal = jobs.reduce(
    (total, job) => total + Number(job.customer_price ?? 0),
    0
  );

  const costTotal = jobs.reduce(
    (total, job) => total + Number(job.subcontractor_cost ?? 0),
    0
  );

  const marginTotal = revenueTotal - costTotal;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.pageHeader}>
          <div>
            <p style={styles.eyebrow}>Transport Operations</p>
            <h1 style={styles.title}>Jobs</h1>
            <p style={styles.subtitle}>
              Create, allocate and manage transport jobs from booking through to
              delivery and invoicing.
            </p>
          </div>

          <button type="button" onClick={resetForm} style={styles.secondaryButton}>
            New Job
          </button>
        </header>

        {message ? <div style={styles.message}>{message}</div> : null}

        <section style={styles.statsGrid}>
          <StatCard label="Active Jobs" value={String(jobs.length)} />
          <StatCard
            label="Revenue"
            value={`£${revenueTotal.toFixed(2)}`}
          />
          <StatCard label="Costs" value={`£${costTotal.toFixed(2)}`} />
          <StatCard
            label="Margin"
            value={`£${marginTotal.toFixed(2)}`}
          />
        </section>

        <form onSubmit={handleSubmit} style={styles.formCard}>
          <div style={styles.formHeader}>
            <div>
              <h2 style={styles.sectionTitle}>
                {editingJobId ? "Edit Job" : "Create Job"}
              </h2>

              <p style={styles.sectionText}>
                Add the booking, allocation, stops and commercial information.
              </p>
            </div>

            {editingJobId ? (
              <button
                type="button"
                onClick={resetForm}
                style={styles.textButton}
              >
                Cancel Edit
              </button>
            ) : null}
          </div>

          <div style={styles.formGrid}>
            <Field label="Job Reference">
              <input
                value={form.reference}
                onChange={(event) =>
                  updateForm("reference", event.target.value)
                }
                required
                placeholder="TMS-2026-001"
                style={styles.input}
              />
            </Field>

            <Field label="Customer Reference">
              <input
                value={form.customer_reference}
                onChange={(event) =>
                  updateForm("customer_reference", event.target.value)
                }
                placeholder="PO / Customer reference"
                style={styles.input}
              />
            </Field>

            <Field label="Job Date">
              <input
                type="date"
                value={form.job_date}
                onChange={(event) =>
                  updateForm("job_date", event.target.value)
                }
                style={styles.input}
              />
            </Field>

            <Field label="Status">
              <select
                value={form.status}
                onChange={(event) =>
                  updateForm("status", event.target.value as JobStatus)
                }
                style={styles.input}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Customer">
              <select
                value={form.customer_id}
                onChange={(event) =>
                  updateForm("customer_id", event.target.value)
                }
                required
                style={styles.input}
              >
                <option value="">Select customer</option>

                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Vehicle">
              <select
                value={form.vehicle_id}
                onChange={(event) =>
                  updateForm("vehicle_id", event.target.value)
                }
                style={styles.input}
              >
                <option value="">Unassigned</option>

                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registration ??
                      vehicle.registration_number ??
                      vehicle.reg ??
                      vehicle.id}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Driver">
              <select
                value={form.driver_id}
                onChange={(event) =>
                  updateForm("driver_id", event.target.value)
                }
                style={styles.input}
              >
                <option value="">Unassigned</option>

                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name ??
                      [driver.first_name, driver.last_name]
                        .filter(Boolean)
                        .join(" ") ??
                      driver.id}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subcontractor">
              <select
                value={form.subcontractor_id}
                onChange={(event) =>
                  updateForm("subcontractor_id", event.target.value)
                }
                style={styles.input}
              >
                <option value="">Own fleet / none</option>

                {subcontractors.map((subcontractor) => (
                  <option key={subcontractor.id} value={subcontractor.id}>
                    {subcontractor.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <StopsSection
            title="Collections"
            type="collection"
            stops={collectionStops}
            onAdd={() => addStop("collection")}
            onRemove={(index) => removeStop("collection", index)}
            onUpdate={(index, field, value) =>
              updateStop("collection", index, field, value)
            }
          />

          <StopsSection
            title="Deliveries"
            type="delivery"
            stops={deliveryStops}
            onAdd={() => addStop("delivery")}
            onRemove={(index) => removeStop("delivery", index)}
            onUpdate={(index, field, value) =>
              updateStop("delivery", index, field, value)
            }
          />

          <div style={styles.formGrid}>
            <Field label="Customer Price">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.customer_price}
                onChange={(event) =>
                  updateForm("customer_price", event.target.value)
                }
                placeholder="0.00"
                style={styles.input}
              />
            </Field>

            <Field label="Subcontractor / Job Cost">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.subcontractor_cost}
                onChange={(event) =>
                  updateForm("subcontractor_cost", event.target.value)
                }
                placeholder="0.00"
                style={styles.input}
              />
            </Field>

            <Field label="Estimated Margin">
              <div style={styles.readOnlyField}>
                £
                {(
                  Number(form.customer_price || 0) -
                  Number(form.subcontractor_cost || 0)
                ).toFixed(2)}
              </div>
            </Field>
          </div>

          <Field label="Job Notes">
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Special instructions, booking information or operational notes..."
              rows={4}
              style={{
                ...styles.input,
                resize: "vertical",
              }}
            />
          </Field>

          <div style={styles.formActions}>
            {editingJobId ? (
              <button
                type="button"
                onClick={resetForm}
                style={styles.secondaryButton}
              >
                Cancel
              </button>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              style={{
                ...styles.primaryButton,
                opacity: saving ? 0.65 : 1,
              }}
            >
              {saving
                ? "Saving..."
                : editingJobId
                  ? "Update Job"
                  : "Create Job"}
            </button>
          </div>
        </form>

        <section style={styles.jobsCard}>
          <div style={styles.jobsHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Current Jobs</h2>
              <p style={styles.sectionText}>
                {filteredJobs.length} job
                {filteredJobs.length === 1 ? "" : "s"}
              </p>
            </div>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs..."
              style={styles.search}
            />
          </div>

          {loading ? (
            <div style={styles.emptyState}>Loading jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div style={styles.emptyState}>
              No jobs match your current search.
            </div>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Reference</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Vehicle / Driver</th>
                    <th style={styles.th}>Subcontractor</th>
                    <th style={styles.th}>Revenue</th>
                    <th style={styles.th}>Margin</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredJobs.map((job) => {
                    const revenue = Number(job.customer_price ?? 0);
                    const cost = Number(job.subcontractor_cost ?? 0);
                    const margin = revenue - cost;

                    return (
                      <tr key={job.id}>
                        <td style={styles.td}>
                          <strong>{job.reference}</strong>

                          {job.customer_reference ? (
                            <div style={styles.muted}>
                              {job.customer_reference}
                            </div>
                          ) : null}
                        </td>

                        <td style={styles.td}>
                          {customerName(job.customer_id)}
                        </td>

                        <td style={styles.td}>
                          {job.job_date
                            ? new Date(
                                `${job.job_date}T00:00:00`
                              ).toLocaleDateString("en-GB")
                            : "—"}
                        </td>

                        <td style={styles.td}>
                          <span style={statusBadge(job.status)}>
                            {formatStatus(job.status)}
                          </span>
                        </td>

                        <td style={styles.td}>
                          <div>{vehicleName(job.vehicle_id)}</div>
                          <div style={styles.muted}>
                            {driverName(job.driver_id)}
                          </div>
                        </td>

                        <td style={styles.td}>
                          {subcontractorName(job.subcontractor_id)}
                        </td>

                        <td style={styles.td}>
                          £{revenue.toFixed(2)}
                        </td>

                        <td style={styles.td}>
                          £{margin.toFixed(2)}
                        </td>

                        <td style={styles.td}>
                          <div style={styles.rowActions}>
                            <button
                              type="button"
                              onClick={() => void editJob(job)}
                              style={styles.smallButton}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => void deleteJob(job)}
                              style={styles.deleteButton}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StopsSection({
  title,
  type,
  stops,
  onAdd,
  onRemove,
  onUpdate,
}: {
  title: string;
  type: "collection" | "delivery";
  stops: Stop[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (
    index: number,
    field: keyof Stop,
    value: string | number
  ) => void;
}) {
  return (
    <section style={styles.stopSection}>
      <div style={styles.stopSectionHeader}>
        <div>
          <h3 style={styles.stopTitle}>{title}</h3>
          <p style={styles.sectionText}>
            Add one or more {type} stops in route order.
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          style={styles.secondaryButton}
        >
          + Add {type === "collection" ? "Collection" : "Delivery"}
        </button>
      </div>

      <div style={styles.stopList}>
        {stops.map((stop, index) => (
          <div key={`${type}-${index}`} style={styles.stopCard}>
            <div style={styles.stopCardHeader}>
              <strong>
                {type === "collection" ? "Collection" : "Delivery"}{" "}
                {index + 1}
              </strong>

              {stops.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  style={styles.textDangerButton}
                >
                  Remove
                </button>
              ) : null}
            </div>

            <div style={styles.formGrid}>
              <Field label="Company / Site">
                <input
                  value={stop.company_name}
                  onChange={(event) =>
                    onUpdate(index, "company_name", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Address Line 1">
                <input
                  value={stop.address_line1}
                  onChange={(event) =>
                    onUpdate(index, "address_line1", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Address Line 2">
                <input
                  value={stop.address_line2}
                  onChange={(event) =>
                    onUpdate(index, "address_line2", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Town / City">
                <input
                  value={stop.city}
                  onChange={(event) =>
                    onUpdate(index, "city", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Postcode">
                <input
                  value={stop.postcode}
                  onChange={(event) =>
                    onUpdate(
                      index,
                      "postcode",
                      event.target.value.toUpperCase()
                    )
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Contact">
                <input
                  value={stop.contact_name}
                  onChange={(event) =>
                    onUpdate(index, "contact_name", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Telephone">
                <input
                  value={stop.phone}
                  onChange={(event) =>
                    onUpdate(index, "phone", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Planned Date">
                <input
                  type="date"
                  value={stop.planned_date}
                  onChange={(event) =>
                    onUpdate(index, "planned_date", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>

              <Field label="Planned Time">
                <input
                  type="time"
                  value={stop.planned_time}
                  onChange={(event) =>
                    onUpdate(index, "planned_time", event.target.value)
                  }
                  style={styles.input}
                />
              </Field>
            </div>

            <Field label="Instructions">
              <textarea
                value={stop.instructions}
                onChange={(event) =>
                  onUpdate(index, "instructions", event.target.value)
                }
                rows={2}
                style={{
                  ...styles.input,
                  resize: "vertical",
                }}
              />
            </Field>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>{label}</span>
      <strong style={styles.statValue}>{value}</strong>
    </div>
  );
}

function formatStatus(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusBadge(status: JobStatus): CSSProperties {
  return {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background:
      status === "completed" ||
      status === "delivered" ||
      status === "invoiced"
        ? "#dcfce7"
        : status === "cancelled"
          ? "#fee2e2"
          : status === "in_transit" ||
              status === "collecting" ||
              status === "collected"
            ? "#dbeafe"
            : "#f1f5f9",
    color:
      status === "completed" ||
      status === "delivered" ||
      status === "invoiced"
        ? "#166534"
        : status === "cancelled"
          ? "#991b1b"
          : status === "in_transit" ||
              status === "collecting" ||
              status === "collected"
            ? "#1d4ed8"
            : "#334155",
  };
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    padding: "32px 20px 60px",
  },

  container: {
    maxWidth: 1450,
    margin: "0 auto",
  },

  pageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
    marginBottom: 24,
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: 0,
    fontSize: "clamp(32px, 5vw, 48px)",
    color: "#0f172a",
    letterSpacing: "-0.04em",
  },

  subtitle: {
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 16,
    maxWidth: 760,
    lineHeight: 1.6,
  },

  message: {
    padding: "13px 16px",
    borderRadius: 12,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e40af",
    marginBottom: 20,
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginBottom: 24,
  },

  statCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
  },

  statLabel: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700,
  },

  statValue: {
    display: "block",
    marginTop: 6,
    fontSize: 27,
    color: "#0f172a",
  },

  formCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.06)",
    marginBottom: 28,
  },

  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    marginBottom: 22,
  },

  sectionTitle: {
    margin: 0,
    fontSize: 22,
    color: "#0f172a",
  },

  sectionText: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: 14,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    marginBottom: 18,
  },

  field: {
    display: "grid",
    gap: 7,
  },

  label: {
    fontSize: 13,
    color: "#334155",
    fontWeight: 700,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    padding: "11px 12px",
    fontSize: 14,
    color: "#0f172a",
    background: "#ffffff",
    outline: "none",
  },

  readOnlyField: {
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    padding: "11px 12px",
    minHeight: 18,
    background: "#f8fafc",
    fontWeight: 700,
  },

  stopSection: {
    marginTop: 24,
    paddingTop: 22,
    borderTop: "1px solid #e2e8f0",
  },

  stopSectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 16,
  },

  stopTitle: {
    margin: 0,
    fontSize: 18,
    color: "#0f172a",
  },

  stopList: {
    display: "grid",
    gap: 14,
  },

  stopCard: {
    padding: 18,
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#f8fafc",
  },

  stopCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    color: "#0f172a",
  },

  formActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 22,
  },

  primaryButton: {
    border: "none",
    borderRadius: 11,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 20px",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 14,
  },

  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    background: "#ffffff",
    color: "#0f172a",
    padding: "11px 16px",
    fontWeight: 700,
    cursor: "pointer",
  },

  textButton: {
    border: "none",
    background: "transparent",
    color: "#2563eb",
    fontWeight: 700,
    cursor: "pointer",
  },

  textDangerButton: {
    border: "none",
    background: "transparent",
    color: "#dc2626",
    fontWeight: 700,
    cursor: "pointer",
  },

  jobsCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.06)",
  },

  jobsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
    flexWrap: "wrap",
    marginBottom: 20,
  },

  search: {
    width: 280,
    maxWidth: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    padding: "11px 13px",
    fontSize: 14,
  },

  tableWrapper: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 1050,
  },

  th: {
    textAlign: "left",
    padding: "12px 10px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },

  td: {
    padding: "14px 10px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 14,
    verticalAlign: "top",
    color: "#0f172a",
  },

  muted: {
    marginTop: 3,
    color: "#94a3b8",
    fontSize: 12,
  },

  rowActions: {
    display: "flex",
    gap: 7,
  },

  smallButton: {
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: 8,
    padding: "7px 10px",
    fontWeight: 700,
    cursor: "pointer",
  },

  deleteButton: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: 8,
    padding: "7px 10px",
    fontWeight: 700,
    cursor: "pointer",
  },

  emptyState: {
    padding: "50px 20px",
    textAlign: "center",
    color: "#64748b",
  },
};




