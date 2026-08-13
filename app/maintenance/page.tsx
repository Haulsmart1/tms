"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";

type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string | null;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  vor: boolean | null;
  vor_since: string | null;
  vor_reason: string | null;
  returned_to_service_at: string | null;
};

type MaintenanceRecord = {
  id: string;
  vehicle_id: string | null;
  maintenance_type: string;
  due_date: string | null;
  completed_date: string | null;
  status: string;
  cost: number | null;
  notes: string | null;
  created_at: string;
};

type MaintenanceRecordWithVehicle = MaintenanceRecord & {
  vehicle: Vehicle | null;
};

export default function MaintenancePage() {
  const supabase = useMemo(() => createClient(), []);

  const [tenantId, setTenantId] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [records, setRecords] = useState<MaintenanceRecordWithVehicle[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vorSaving, setVorSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [vehicleId, setVehicleId] = useState("");
  const [maintenanceType, setMaintenanceType] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [status, setStatus] = useState("due");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [vorReason, setVorReason] = useState("");

  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;

  const vorVehicles = vehicles.filter(
    (vehicle) => vehicle.vor === true || vehicle.active === false
  );

  const resolveTenantId = useCallback(async (): Promise<string | null> => {
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
        "Your account is not linked to a TMS Wizzard tenant."
      );
    }

    return profile.tenant_id as string;
  }, [supabase]);

  const loadData = useCallback(
    async (currentTenantId: string) => {
      setLoading(true);
      setErrorMessage("");

      try {
        const [vehicleResult, maintenanceResult] = await Promise.all([
          supabase
            .from("vehicles")
            .select(
              `
              id,
              tenant_id,
              registration,
              vehicle_type,
              make,
              model,
              active,
              vor,
              vor_since,
              vor_reason,
              returned_to_service_at
              `
            )
            .eq("tenant_id", currentTenantId)
            .order("registration", { ascending: true }),

          supabase
            .from("maintenance_records")
            .select(
              `
              id,
              vehicle_id,
              maintenance_type,
              due_date,
              completed_date,
              status,
              cost,
              notes,
              created_at
              `
            )
            .order("created_at", { ascending: false }),
        ]);

        if (vehicleResult.error) {
          throw vehicleResult.error;
        }

        if (maintenanceResult.error) {
          throw maintenanceResult.error;
        }

        const tenantVehicles = (vehicleResult.data ?? []) as Vehicle[];

        const vehicleMap = new Map(
          tenantVehicles.map((vehicle) => [vehicle.id, vehicle])
        );

        const tenantMaintenance = (maintenanceResult.data ?? [])
          .map(
            (record): MaintenanceRecordWithVehicle => ({
              ...(record as MaintenanceRecord),
              vehicle: record.vehicle_id
                ? vehicleMap.get(record.vehicle_id) ?? null
                : null,
            })
          )
          .filter((record) => record.vehicle !== null);

        setVehicles(tenantVehicles);
        setRecords(tenantMaintenance);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load maintenance information."
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
        const resolvedTenantId = await resolveTenantId();

        if (!resolvedTenantId) {
          return;
        }

        setTenantId(resolvedTenantId);
        await loadData(resolvedTenantId);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialise maintenance."
        );

        setLoading(false);
      }
    }

    void initialise();
  }, [resolveTenantId, loadData]);

  function resetForm() {
    setVehicleId("");
    setMaintenanceType("");
    setDueDate("");
    setCompletedDate("");
    setStatus("due");
    setCost("");
    setNotes("");
    setVorReason("");
  }

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    clearMessages();

    if (!tenantId) {
      setErrorMessage("Tenant not loaded.");
      return;
    }

    if (!vehicleId) {
      setErrorMessage("Please select a vehicle.");
      return;
    }

    if (!maintenanceType.trim()) {
      setErrorMessage("Please enter a maintenance type.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        vehicle_id: vehicleId,
        maintenance_type: maintenanceType.trim(),
        due_date: dueDate || null,
        completed_date: completedDate || null,
        status,
        cost: cost.trim() !== "" ? Number(cost) : null,
        notes: notes.trim() || null,
      };

      const { error } = await supabase
        .from("maintenance_records")
        .insert(payload);

      if (error) {
        throw error;
      }

      if (status === "vor") {
        const reason =
          vorReason.trim() ||
          notes.trim() ||
          maintenanceType.trim();

        const { error: vehicleError } = await supabase
          .from("vehicles")
          .update({
            vor: true,
            active: false,
            vor_since: new Date().toISOString(),
            vor_reason: reason,
          })
          .eq("id", vehicleId)
          .eq("tenant_id", tenantId);

        if (vehicleError) {
          throw new Error(
            `Maintenance record saved, but VOR update failed: ${vehicleError.message}`
          );
        }
      }

      setMessage(
        status === "vor"
          ? "Maintenance record saved and vehicle marked VOR."
          : "Maintenance record added."
      );

      resetForm();
      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save maintenance record."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteMaintenanceRecord(recordId: string) {
    if (!tenantId) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this maintenance record? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    clearMessages();
    setDeletingId(recordId);

    try {
      const { error } = await supabase
        .from("maintenance_records")
        .delete()
        .eq("id", recordId);

      if (error) {
        throw error;
      }

      setMessage("Maintenance record deleted.");
      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to delete maintenance record."
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function placeVehicleVor(vehicle: Vehicle) {
    if (!tenantId) {
      return;
    }

    clearMessages();

    const reason = vorReason.trim();

    if (!reason) {
      setErrorMessage(
        "Please enter a VOR reason before taking the vehicle off the road."
      );
      return;
    }

    const confirmed = window.confirm(
      `Mark ${
        vehicle.registration ?? "this vehicle"
      } as VOR?\n\nThe vehicle will be unavailable for operations.`
    );

    if (!confirmed) {
      return;
    }

    setVorSaving(true);

    try {
      const now = new Date().toISOString();

      const { error } = await supabase
        .from("vehicles")
        .update({
          vor: true,
          active: false,
          vor_since: now,
          vor_reason: reason,
        })
        .eq("id", vehicle.id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw error;
      }

      setMessage(`${vehicle.registration ?? "Vehicle"} is now VOR.`);
      setVorReason("");

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to mark vehicle VOR."
      );
    } finally {
      setVorSaving(false);
    }
  }

  async function returnVehicleToService(vehicle: Vehicle) {
    if (!tenantId) {
      return;
    }

    clearMessages();

    const confirmed = window.confirm(
      `Return ${vehicle.registration ?? "this vehicle"} to service?`
    );

    if (!confirmed) {
      return;
    }

    setVorSaving(true);

    try {
      const now = new Date().toISOString();

      const { error } = await supabase
        .from("vehicles")
        .update({
          vor: false,
          active: true,
          vor_since: null,
          vor_reason: null,
          returned_to_service_at: now,
        })
        .eq("id", vehicle.id)
        .eq("tenant_id", tenantId);

      if (error) {
        throw error;
      }

      setMessage(
        `${vehicle.registration ?? "Vehicle"} returned to service.`
      );

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to return vehicle to service."
      );
    } finally {
      setVorSaving(false);
    }
  }

  function vehicleLabel(vehicle: Vehicle) {
    const description = [
      vehicle.registration || "No registration",
      vehicle.vehicle_type,
      [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null,
      vehicle.vor || vehicle.active === false ? "VOR" : "In Service",
    ].filter(Boolean);

    return description.join(" • ");
  }

  return (
    <main style={styles.page}>
      <div style={styles.overlay}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Fleet Compliance</p>

            <h1 style={styles.title}>Maintenance Records</h1>

            <p style={styles.subtitle}>
              Manage maintenance, defects and vehicle off-road status.
            </p>
          </div>

          <div style={styles.headerStats}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Fleet</span>
              <strong style={styles.statValue}>{vehicles.length}</strong>
            </div>

            <div style={styles.stat}>
              <span style={styles.statLabel}>VOR</span>

              <strong
                style={{
                  ...styles.statValue,
                  color: vorVehicles.length > 0 ? "#dc2626" : "#16a34a",
                }}
              >
                {vorVehicles.length}
              </strong>
            </div>
          </div>
        </header>

        {errorMessage ? (
          <div style={styles.errorMessage}>{errorMessage}</div>
        ) : null}

        {message ? (
          <div style={styles.successMessage}>{message}</div>
        ) : null}

        {vorVehicles.length > 0 ? (
          <section style={styles.vorPanel}>
            <div style={styles.sectionHeading}>
              <div>
                <h2 style={styles.sectionTitle}>Vehicles Off Road</h2>

                <p style={styles.sectionDescription}>
                  These vehicles should not be allocated to jobs.
                </p>
              </div>

              <span style={styles.vorBadge}>
                {vorVehicles.length} VOR
              </span>
            </div>

            <div style={styles.vorGrid}>
              {vorVehicles.map((vehicle) => (
                <div key={vehicle.id} style={styles.vorCard}>
                  <div>
                    <strong style={styles.vehicleRegistration}>
                      {vehicle.registration ?? "Vehicle"}
                    </strong>

                    <div style={styles.vehicleDescription}>
                      {[
                        vehicle.make,
                        vehicle.model,
                        vehicle.vehicle_type,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "No description"}
                    </div>
                  </div>

                  <div style={styles.vorReasonBox}>
                    <span style={styles.smallLabel}>VOR reason</span>

                    <strong>
                      {vehicle.vor_reason || "Not recorded"}
                    </strong>

                    {vehicle.vor_since ? (
                      <span style={styles.smallText}>
                        Since {formatDateTime(vehicle.vor_since)}
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={vorSaving}
                    onClick={() =>
                      void returnVehicleToService(vehicle)
                    }
                    style={styles.returnButton}
                  >
                    Return to Service
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={styles.formCard}>
          <div style={styles.sectionHeading}>
            <div>
              <h2 style={styles.sectionTitle}>
                Add Maintenance Record
              </h2>

              <p style={styles.sectionDescription}>
                Record inspections, repairs, servicing or defects.
              </p>
            </div>
          </div>

          <form onSubmit={createRecord} style={styles.form}>
            <label style={styles.field}>
              <span style={styles.label}>Vehicle</span>

              <select
                value={vehicleId}
                onChange={(event) => {
                  setVehicleId(event.target.value);
                  setVorReason("");
                }}
                style={styles.input}
                required
              >
                <option value="">Select vehicle</option>

                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicleLabel(vehicle)}
                  </option>
                ))}
              </select>
            </label>

            {selectedVehicle ? (
              <div
                style={
                  selectedVehicle.vor ||
                  selectedVehicle.active === false
                    ? styles.selectedVehicleVor
                    : styles.selectedVehicleActive
                }
              >
                <div>
                  <span style={styles.smallLabel}>
                    Vehicle Status
                  </span>

                  <strong style={styles.selectedVehicleTitle}>
                    {selectedVehicle.registration ?? "Vehicle"}
                  </strong>

                  <span style={styles.smallText}>
                    {selectedVehicle.vor ||
                    selectedVehicle.active === false
                      ? "Vehicle Off Road"
                      : "Available for Service"}
                  </span>
                </div>

                {selectedVehicle.vor ||
                selectedVehicle.active === false ? (
                  <button
                    type="button"
                    disabled={vorSaving}
                    onClick={() =>
                      void returnVehicleToService(selectedVehicle)
                    }
                    style={styles.returnButton}
                  >
                    Return to Service
                  </button>
                ) : (
                  <div style={styles.vorControl}>
                    <input
                      type="text"
                      value={vorReason}
                      onChange={(event) =>
                        setVorReason(event.target.value)
                      }
                      placeholder="Reason for VOR"
                      style={styles.input}
                    />

                    <button
                      type="button"
                      disabled={vorSaving}
                      onClick={() =>
                        void placeVehicleVor(selectedVehicle)
                      }
                      style={styles.vorButton}
                    >
                      VOR Vehicle
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div style={styles.formGrid}>
              <label style={styles.field}>
                <span style={styles.label}>
                  Maintenance Type
                </span>

                <input
                  type="text"
                  placeholder="e.g. PMI, tyres, brakes, service"
                  value={maintenanceType}
                  onChange={(event) =>
                    setMaintenanceType(event.target.value)
                  }
                  style={styles.input}
                  required
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Status</span>

                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value)
                  }
                  style={styles.input}
                >
                  <option value="due">Due</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue</option>
                  <option value="vor">VOR</option>
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Due Date</span>

                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) =>
                    setDueDate(event.target.value)
                  }
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>
                  Completed Date
                </span>

                <input
                  type="date"
                  value={completedDate}
                  onChange={(event) =>
                    setCompletedDate(event.target.value)
                  }
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Cost</span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={cost}
                  onChange={(event) =>
                    setCost(event.target.value)
                  }
                  style={styles.input}
                />
              </label>
            </div>

            {status === "vor" &&
            selectedVehicle &&
            !selectedVehicle.vor ? (
              <label style={styles.field}>
                <span style={styles.label}>VOR Reason</span>

                <input
                  type="text"
                  value={vorReason}
                  onChange={(event) =>
                    setVorReason(event.target.value)
                  }
                  placeholder="Why is the vehicle off road?"
                  style={styles.input}
                />
              </label>
            ) : null}

            <label style={styles.field}>
              <span style={styles.label}>Notes</span>

              <textarea
                value={notes}
                onChange={(event) =>
                  setNotes(event.target.value)
                }
                placeholder="Maintenance notes..."
                rows={4}
                style={{
                  ...styles.input,
                  resize: "vertical",
                }}
              />
            </label>

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
                : "Add Maintenance Record"}
            </button>
          </form>
        </section>

        <section style={styles.recordsSection}>
          <div style={styles.sectionHeading}>
            <div>
              <h2 style={styles.sectionTitle}>
                Maintenance History
              </h2>

              <p style={styles.sectionDescription}>
                {records.length} maintenance record
                {records.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {loading ? (
            <div style={styles.empty}>
              Loading maintenance records...
            </div>
          ) : records.length === 0 ? (
            <div style={styles.empty}>
              No maintenance records found.
            </div>
          ) : (
            <div style={styles.recordGrid}>
              {records.map((record) => (
                <article
                  key={record.id}
                  style={styles.recordCard}
                >
                  <div style={styles.recordHeader}>
                    <div>
                      <h3 style={styles.recordTitle}>
                        {record.maintenance_type}
                      </h3>

                      <p style={styles.recordVehicle}>
                        {record.vehicle?.registration ||
                          [
                            record.vehicle?.make,
                            record.vehicle?.model,
                          ]
                            .filter(Boolean)
                            .join(" ") ||
                          "Vehicle"}
                      </p>
                    </div>

                    <span
                      style={maintenanceStatusStyle(
                        record.status
                      )}
                    >
                      {formatStatus(record.status)}
                    </span>
                  </div>

                  <div style={styles.recordDetails}>
                    <RecordItem
                      label="Due"
                      value={record.due_date || "—"}
                    />

                    <RecordItem
                      label="Completed"
                      value={
                        record.completed_date || "—"
                      }
                    />

                    <RecordItem
                      label="Cost"
                      value={
                        record.cost !== null
                          ? `£${Number(
                              record.cost
                            ).toFixed(2)}`
                          : "—"
                      }
                    />
                  </div>

                  {record.notes ? (
                    <div style={styles.notesBox}>
                      {record.notes}
                    </div>
                  ) : null}

                  {record.vehicle?.vor ? (
                    <div style={styles.recordVorWarning}>
                      Vehicle currently VOR
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={deletingId === record.id}
                    onClick={() =>
                      void deleteMaintenanceRecord(
                        record.id
                      )
                    }
                    style={{
                      ...styles.deleteButton,
                      opacity:
                        deletingId === record.id
                          ? 0.6
                          : 1,
                    }}
                  >
                    {deletingId === record.id
                      ? "Deleting..."
                      : "Delete Record"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function RecordItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span style={styles.smallLabel}>{label}</span>

      <strong style={styles.recordValue}>{value}</strong>
    </div>
  );
}

function formatStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maintenanceStatusStyle(
  status: string
): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };

  if (status === "completed") {
    return {
      ...base,
      background: "#dcfce7",
      color: "#166534",
    };
  }

  if (status === "vor" || status === "overdue") {
    return {
      ...base,
      background: "#fee2e2",
      color: "#991b1b",
    };
  }

  if (status === "in_progress") {
    return {
      ...base,
      background: "#dbeafe",
      color: "#1d4ed8",
    };
  }

  return {
    ...base,
    background: "#fef3c7",
    color: "#92400e",
  };
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 30,
    boxSizing: "border-box",
    backgroundImage:
      "url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  },

  overlay: {
    maxWidth: 1400,
    margin: "0 auto",
    background: "rgba(2,6,23,0.72)",
    padding: 28,
    borderRadius: 22,
    backdropFilter: "blur(3px)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 20,
    marginBottom: 24,
  },

  eyebrow: {
    margin: "0 0 6px",
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },

  title: {
    color: "#ffffff",
    margin: 0,
    fontSize: "clamp(30px, 5vw, 46px)",
    letterSpacing: "-0.03em",
  },

  subtitle: {
    color: "#cbd5e1",
    margin: "7px 0 0",
  },

  headerStats: {
    display: "flex",
    gap: 10,
  },

  stat: {
    minWidth: 90,
    background: "rgba(255,255,255,0.95)",
    borderRadius: 13,
    padding: "12px 16px",
  },

  statLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
  },

  statValue: {
    display: "block",
    marginTop: 4,
    fontSize: 25,
    color: "#0f172a",
  },

  successMessage: {
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
    padding: 13,
    borderRadius: 11,
    marginBottom: 18,
    fontWeight: 700,
  },

  errorMessage: {
    background: "#fee2e2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    padding: 13,
    borderRadius: 11,
    marginBottom: 18,
    fontWeight: 700,
  },

  formCard: {
    background: "rgba(255,255,255,0.97)",
    padding: 22,
    borderRadius: 17,
    boxShadow: "0 10px 35px rgba(0,0,0,0.2)",
    marginBottom: 22,
  },

  form: {
    display: "grid",
    gap: 16,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 14,
  },

  field: {
    display: "grid",
    gap: 7,
  },

  label: {
    fontSize: 13,
    fontWeight: 800,
    color: "#334155",
  },

  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    boxSizing: "border-box",
    fontSize: 14,
    background: "#ffffff",
    color: "#0f172a",
  },

  primaryButton: {
    width: "100%",
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    padding: 13,
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 14,
  },

  sectionHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 15,
    marginBottom: 16,
  },

  sectionTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 21,
  },

  sectionDescription: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: 13,
  },

  selectedVehicleActive: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    padding: 16,
    borderRadius: 13,
    background: "#f0fdf4",
    border: "1px solid #86efac",
  },

  selectedVehicleVor: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    padding: 16,
    borderRadius: 13,
    background: "#fef2f2",
    border: "1px solid #fecaca",
  },

  selectedVehicleTitle: {
    display: "block",
    fontSize: 18,
    marginTop: 3,
  },

  vorControl: {
    display: "flex",
    gap: 8,
    flex: "1 1 400px",
    justifyContent: "flex-end",
  },

  vorButton: {
    flexShrink: 0,
    border: "none",
    borderRadius: 10,
    padding: "11px 15px",
    color: "#ffffff",
    background: "#dc2626",
    fontWeight: 800,
    cursor: "pointer",
  },

  returnButton: {
    border: "none",
    borderRadius: 10,
    padding: "11px 15px",
    color: "#ffffff",
    background: "#16a34a",
    fontWeight: 800,
    cursor: "pointer",
  },

  vorPanel: {
    background: "#fff7f7",
    border: "2px solid #ef4444",
    padding: 20,
    borderRadius: 17,
    marginBottom: 22,
  },

  vorBadge: {
    borderRadius: 999,
    background: "#dc2626",
    color: "#ffffff",
    padding: "6px 11px",
    fontWeight: 900,
    fontSize: 12,
  },

  vorGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(270px, 1fr))",
    gap: 12,
  },

  vorCard: {
    background: "#ffffff",
    border: "1px solid #fecaca",
    borderRadius: 13,
    padding: 15,
    display: "grid",
    gap: 13,
  },

  vehicleRegistration: {
    fontSize: 19,
  },

  vehicleDescription: {
    color: "#64748b",
    fontSize: 13,
    marginTop: 3,
  },

  vorReasonBox: {
    display: "grid",
    gap: 3,
    padding: 11,
    background: "#fef2f2",
    borderRadius: 9,
  },

  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },

  smallText: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    marginTop: 3,
  },

  recordsSection: {
    background: "rgba(255,255,255,0.97)",
    padding: 22,
    borderRadius: 17,
    boxShadow: "0 10px 35px rgba(0,0,0,0.2)",
  },

  recordGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 14,
  },

  recordCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 17,
    background: "#f8fafc",
  },

  recordHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 15,
  },

  recordTitle: {
    margin: 0,
    color: "#0f172a",
  },

  recordVehicle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 13,
  },

  recordDetails: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3, minmax(0, 1fr))",
    gap: 10,
  },

  recordValue: {
    display: "block",
    marginTop: 3,
    fontSize: 13,
  },

  notesBox: {
    marginTop: 14,
    padding: 11,
    borderRadius: 9,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontSize: 13,
  },

  recordVorWarning: {
    marginTop: 12,
    padding: 9,
    textAlign: "center",
    borderRadius: 8,
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 12,
    fontWeight: 900,
  },

  deleteButton: {
    width: "100%",
    marginTop: 12,
    border: "1px solid #fecaca",
    borderRadius: 9,
    padding: "9px 12px",
    background: "#fef2f2",
    color: "#b91c1c",
    fontWeight: 800,
    cursor: "pointer",
  },

  empty: {
    padding: 35,
    textAlign: "center",
    color: "#64748b",
  },
};