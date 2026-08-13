"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";

type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  created_at?: string;
  mot_expiry: string | null;
  tax_expiry: string | null;
  insurance_type: "individual" | "fleet" | null;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_start_date: string | null;
  insurance_expiry: string | null;
  fleet_insurance_policy_id: string | null;
};

type FleetInsurancePolicy = {
  id: string;
  tenant_id: string;
  provider: string;
  policy_number: string;
  start_date: string | null;
  expiry_date: string;
  auto_renew: boolean;
  renewal_notice_days: number;
  active: boolean;
  notes: string | null;
};

type ComplianceLevel = "ok" | "amber" | "red";

type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};

const inputStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  minWidth: 160,
};

const buttonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};

const deleteButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const EMPTY_FORM = {
  registration: "",
  vehicle_type: "",
  make: "",
  model: "",
  mot_expiry: "",
  tax_expiry: "",
  insurance_type: "individual" as "individual" | "fleet",
  insurance_provider: "",
  insurance_policy_number: "",
  insurance_start_date: "",
  insurance_expiry: "",
  fleet_insurance_policy_id: "",
};

export default function VehiclesPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fleetPolicies, setFleetPolicies] = useState<FleetInsurancePolicy[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);

  async function loadVehicles() {
    setLoading(true);

    const [vehicleResult, policyResult] = await Promise.all([
      tenant
        .filterByTenant(supabase.from("vehicles").select("*"))
        .order("created_at", { ascending: false }),
      tenant
        .filterByTenant(
          supabase
            .from("fleet_insurance_policies")
            .select(
              "id, tenant_id, provider, policy_number, start_date, expiry_date, auto_renew, renewal_notice_days, active, notes"
            )
        )
        .order("expiry_date", { ascending: true }),
    ]);

    if (vehicleResult.error) {
      setMessage(vehicleResult.error.message);
      setVehicles([]);
    } else {
      setVehicles((vehicleResult.data as Vehicle[]) || []);
    }

    if (policyResult.error) {
      setMessage((current) =>
        current
          ? `${current} | ${policyResult.error?.message ?? ""}`
          : policyResult.error?.message ?? ""
      );
      setFleetPolicies([]);
    } else {
      setFleetPolicies(
        ((policyResult.data as FleetInsurancePolicy[]) || []).filter(
          (policy) => policy.active
        )
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.activeTenantId]);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setMessage("");

    setForm({
      registration: vehicle.registration || "",
      vehicle_type: vehicle.vehicle_type || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      mot_expiry: vehicle.mot_expiry || "",
      tax_expiry: vehicle.tax_expiry || "",
      insurance_type:
        vehicle.insurance_type === "fleet" ? "fleet" : "individual",
      insurance_provider: vehicle.insurance_provider || "",
      insurance_policy_number: vehicle.insurance_policy_number || "",
      insurance_start_date: vehicle.insurance_start_date || "",
      insurance_expiry: vehicle.insurance_expiry || "",
      fleet_insurance_policy_id: vehicle.fleet_insurance_policy_id || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!form.registration.trim()) {
      setMessage("Registration required.");
      return;
    }

    if (!editingId && !tenant.writeTenantId) {
      setMessage("Pick a specific tenant to create records.");
      return;
    }

    if (
      form.insurance_type === "fleet" &&
      !form.fleet_insurance_policy_id
    ) {
      setMessage("Select a fleet insurance policy.");
      return;
    }

    setSaving(true);

    const payload = {
      registration: form.registration.trim().toUpperCase(),
      vehicle_type: form.vehicle_type.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      mot_expiry: form.mot_expiry || null,
      tax_expiry: form.tax_expiry || null,
      insurance_type: form.insurance_type,
      insurance_provider:
        form.insurance_type === "individual"
          ? form.insurance_provider.trim() || null
          : null,
      insurance_policy_number:
        form.insurance_type === "individual"
          ? form.insurance_policy_number.trim() || null
          : null,
      insurance_start_date:
        form.insurance_type === "individual"
          ? form.insurance_start_date || null
          : null,
      insurance_expiry:
        form.insurance_type === "individual"
          ? form.insurance_expiry || null
          : null,
      fleet_insurance_policy_id:
        form.insurance_type === "fleet"
          ? form.fleet_insurance_policy_id || null
          : null,
    };

    let error: { message?: string } | null = null;
    const wasEditing = Boolean(editingId);

    if (editingId) {
      const result = await supabase
        .from("vehicles")
        .update(payload)
        .eq("id", editingId);

      error = result.error;
    } else {
      const result = await supabase.from("vehicles").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
          active: true,
        },
      ]);

      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save vehicle.");
      setSaving(false);
      return;
    }

    resetForm();
    setMessage(wasEditing ? "Vehicle updated." : "Vehicle created.");
    await loadVehicles();
    setSaving(false);
  }

  async function deleteVehicle(id: string) {
    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!window.confirm("Delete vehicle?")) {
      return;
    }

    setMessage("");

    const { error } = await supabase.from("vehicles").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Vehicle deleted.");
    await loadVehicles();
  }

  async function toggleVehicle(id: string, active: boolean | null) {
    setMessage("");

    const { error } = await supabase
      .from("vehicles")
      .update({ active: !active })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(!active ? "Vehicle activated." : "Vehicle deactivated.");
    await loadVehicles();
  }

  function getFleetPolicy(vehicle: Vehicle) {
    return fleetPolicies.find(
      (policy) => policy.id === vehicle.fleet_insurance_policy_id
    );
  }

  function getInsuranceExpiry(vehicle: Vehicle) {
    if (vehicle.insurance_type === "fleet") {
      return getFleetPolicy(vehicle)?.expiry_date ?? null;
    }

    return vehicle.insurance_expiry;
  }

  function getVehicleCardCompliance(vehicle: Vehicle): ComplianceResult {
    const mot = getCompliance(vehicle.mot_expiry);
    const tax = getCompliance(vehicle.tax_expiry);
    const insurance = getCompliance(getInsuranceExpiry(vehicle));

    return mostUrgent([mot, tax, insurance]);
  }

  return (
    <TenantGate>
      <main
        style={{
          minHeight: "100vh",
          padding: 30,
          backgroundImage:
            "url('https://images.unsplash.com/photo-1519003722824-194d4455a60c')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div
          style={{
            background: "rgba(0,0,0,0.62)",
            padding: 30,
            borderRadius: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1 style={{ color: "white", marginTop: 0, marginBottom: 6 }}>
                Vehicles
              </h1>
              <p style={{ color: "#e5e7eb", marginTop: 0 }}>
                Fleet, MOT, tax and insurance compliance.
              </p>
            </div>

            <ComplianceLegend />
          </div>

          {isAdmin ? (
            <form
              onSubmit={saveVehicle}
              style={{
                background: "white",
                padding: 20,
                borderRadius: 14,
                marginBottom: 20,
                display: "grid",
                gap: 16,
              }}
            >
              <h2 style={{ margin: 0 }}>
                {editingId ? "Edit Vehicle" : "Add Vehicle"}
              </h2>

              <SectionTitle>Vehicle Details</SectionTitle>

              <div style={formGridStyle}>
                <input
                  style={inputStyle}
                  placeholder="Registration"
                  value={form.registration}
                  onChange={(event) =>
                    setForm({ ...form, registration: event.target.value })
                  }
                />

                <input
                  style={inputStyle}
                  placeholder="Vehicle type"
                  value={form.vehicle_type}
                  onChange={(event) =>
                    setForm({ ...form, vehicle_type: event.target.value })
                  }
                />

                <input
                  style={inputStyle}
                  placeholder="Make"
                  value={form.make}
                  onChange={(event) =>
                    setForm({ ...form, make: event.target.value })
                  }
                />

                <input
                  style={inputStyle}
                  placeholder="Model"
                  value={form.model}
                  onChange={(event) =>
                    setForm({ ...form, model: event.target.value })
                  }
                />
              </div>

              <SectionTitle>MOT & Tax</SectionTitle>

              <div style={formGridStyle}>
                <DateField
                  label="MOT Expiry"
                  value={form.mot_expiry}
                  onChange={(value) => setForm({ ...form, mot_expiry: value })}
                />

                <DateField
                  label="Tax Expiry"
                  value={form.tax_expiry}
                  onChange={(value) => setForm({ ...form, tax_expiry: value })}
                />
              </div>

              <SectionTitle>Insurance</SectionTitle>

              <div style={formGridStyle}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Insurance Type</span>
                  <select
                    style={inputStyle}
                    value={form.insurance_type}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        insurance_type: event.target.value as
                          | "individual"
                          | "fleet",
                      })
                    }
                  >
                    <option value="individual">Individual Policy</option>
                    <option value="fleet">Fleet Policy</option>
                  </select>
                </label>

                {form.insurance_type === "fleet" ? (
                  <label style={fieldStyle}>
                    <span style={labelStyle}>Fleet Insurance Policy</span>
                    <select
                      style={inputStyle}
                      value={form.fleet_insurance_policy_id}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          fleet_insurance_policy_id: event.target.value,
                        })
                      }
                    >
                      <option value="">Select fleet policy</option>
                      {fleetPolicies.map((policy) => (
                        <option key={policy.id} value={policy.id}>
                          {policy.provider} • {policy.policy_number} • expires{" "}
                          {formatDate(policy.expiry_date)}
                          {policy.auto_renew ? " • auto renew" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <input
                      style={inputStyle}
                      placeholder="Insurance provider"
                      value={form.insurance_provider}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          insurance_provider: event.target.value,
                        })
                      }
                    />

                    <input
                      style={inputStyle}
                      placeholder="Policy number"
                      value={form.insurance_policy_number}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          insurance_policy_number: event.target.value,
                        })
                      }
                    />

                    <DateField
                      label="Insurance Start"
                      value={form.insurance_start_date}
                      onChange={(value) =>
                        setForm({ ...form, insurance_start_date: value })
                      }
                    />

                    <DateField
                      label="Insurance Expiry"
                      value={form.insurance_expiry}
                      onChange={(value) =>
                        setForm({ ...form, insurance_expiry: value })
                      }
                    />
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="submit" style={buttonStyle} disabled={saving}>
                  {saving ? "Saving..." : editingId ? "Update" : "Add"}
                </button>

                {editingId ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={resetForm}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {message ? (
            <div
              style={{
                background: "white",
                padding: 12,
                borderRadius: 10,
                marginBottom: 20,
              }}
            >
              {message}
            </div>
          ) : null}

          {loading ? (
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 14,
              }}
            >
              Loading vehicles...
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 16 }}>
            {vehicles.map((vehicle) => {
              const cardCompliance = getVehicleCardCompliance(vehicle);
              const mot = getCompliance(vehicle.mot_expiry);
              const tax = getCompliance(vehicle.tax_expiry);
              const policy = getFleetPolicy(vehicle);
              const insuranceExpiry = getInsuranceExpiry(vehicle);
              const insurance = getCompliance(insuranceExpiry);

              return (
                <div
                  key={vehicle.id}
                  style={{
                    ...vehicleCardStyle(cardCompliance.level),
                    opacity: vehicle.active ? 1 : 0.7,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 24 }}>
                        {vehicle.registration}
                      </h3>

                      <div style={{ opacity: 0.7 }}>
                        {vehicle.vehicle_type || "No type"} •{" "}
                        {vehicle.make || "-"} {vehicle.model || ""}
                      </div>
                    </div>

                    <StatusBadge result={cardCompliance} />
                  </div>

                  <div style={complianceGridStyle}>
                    <ComplianceItem
                      label="MOT"
                      expiry={vehicle.mot_expiry}
                      result={mot}
                    />

                    <ComplianceItem
                      label="Tax"
                      expiry={vehicle.tax_expiry}
                      result={tax}
                    />

                    <ComplianceItem
                      label="Insurance"
                      expiry={insuranceExpiry}
                      result={insurance}
                      extra={
                        vehicle.insurance_type === "fleet"
                          ? policy
                            ? `Fleet • ${policy.provider}${
                                policy.auto_renew ? " • Auto renew" : ""
                              }`
                            : "Fleet policy not selected"
                          : vehicle.insurance_provider || "Individual policy"
                      }
                    />
                  </div>

                  <div style={{ marginTop: 10, fontSize: 14, opacity: 0.8 }}>
                    Status: {vehicle.active ? "Active" : "Inactive"}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => startEdit(vehicle)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          style={deleteButtonStyle}
                          onClick={() => void deleteVehicle(vehicle.id)}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}

                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() =>
                        void toggleVehicle(vehicle.id, vehicle.active)
                      }
                    >
                      {vehicle.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </TenantGate>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 800,
        color: "#475569",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        type="date"
        style={inputStyle}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ComplianceLegend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 12,
        padding: 10,
      }}
    >
      <span style={legendStyle("#f8fafc", "#334155")}>31+ days</span>
      <span style={legendStyle("#fef3c7", "#92400e")}>30–8 days</span>
      <span style={legendStyle("#fee2e2", "#991b1b")}>7 days / expired</span>
    </div>
  );
}

function ComplianceItem({
  label,
  expiry,
  result,
  extra,
}: {
  label: string;
  expiry: string | null;
  result: ComplianceResult;
  extra?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.12)",
        borderRadius: 12,
        padding: 12,
        background: "rgba(255,255,255,0.72)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          color: "#64748b",
          textTransform: "uppercase",
          marginBottom: 5,
        }}
      >
        {label}
      </div>

      <div style={{ fontWeight: 800 }}>{expiry ? formatDate(expiry) : "Not set"}</div>

      {extra ? (
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
          {extra}
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        <StatusBadge result={result} small />
      </div>
    </div>
  );
}

function StatusBadge({
  result,
  small = false,
}: {
  result: ComplianceResult;
  small?: boolean;
}) {
  const palette =
    result.level === "red"
      ? { background: "#fee2e2", color: "#991b1b", border: "#fca5a5" }
      : result.level === "amber"
        ? { background: "#fef3c7", color: "#92400e", border: "#fcd34d" }
        : { background: "#dcfce7", color: "#166534", border: "#86efac" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: small ? "4px 7px" : "7px 10px",
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontWeight: 900,
        fontSize: small ? 11 : 12,
      }}
    >
      {result.label}
    </span>
  );
}

function getCompliance(expiry: string | null): ComplianceResult {
  if (!expiry) {
    return {
      level: "amber",
      label: "DATE NEEDED",
      days: null,
    };
  }

  const today = startOfToday();
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const diffMs = expiryDate.getTime() - today.getTime();
  const days = Math.ceil(diffMs / 86_400_000);

  if (days < 0) {
    return {
      level: "red",
      label: `EXPIRED ${Math.abs(days)}d`,
      days,
    };
  }

  if (days <= 7) {
    return {
      level: "red",
      label: days === 0 ? "EXPIRES TODAY" : `NEEDS ATTENTION • ${days}d`,
      days,
    };
  }

  if (days <= 30) {
    return {
      level: "amber",
      label: `EXPIRING SOON • ${days}d`,
      days,
    };
  }

  return {
    level: "ok",
    label: `VALID • ${days}d`,
    days,
  };
}

function mostUrgent(results: ComplianceResult[]): ComplianceResult {
  const rank: Record<ComplianceLevel, number> = {
    ok: 0,
    amber: 1,
    red: 2,
  };

  return results.reduce((current, next) =>
    rank[next.level] > rank[current.level] ? next : current
  );
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB");
}

function vehicleCardStyle(level: ComplianceLevel): CSSProperties {
  if (level === "red") {
    return {
      background: "#fff1f2",
      border: "3px solid #dc2626",
      boxShadow: "0 10px 28px rgba(220,38,38,0.18)",
      padding: 20,
      borderRadius: 14,
    };
  }

  if (level === "amber") {
    return {
      background: "#fffbeb",
      border: "3px solid #f59e0b",
      boxShadow: "0 10px 28px rgba(245,158,11,0.15)",
      padding: 20,
      borderRadius: 14,
    };
  }

  return {
    background: "white",
    border: "1px solid #e5e7eb",
    padding: 20,
    borderRadius: 14,
  };
}

function legendStyle(background: string, color: string): CSSProperties {
  return {
    borderRadius: 999,
    padding: "5px 8px",
    background,
    color,
    fontWeight: 800,
    fontSize: 11,
  };
}

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 12,
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
};

const complianceGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 10,
  marginTop: 16,
};
