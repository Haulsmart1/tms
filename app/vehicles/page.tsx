"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  minWidth: 160,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};

const deleteButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#dc2626",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  created_at?: string;
};

export default function VehiclesPage() {
  const supabase = createClient();
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    registration: "",
    vehicle_type: "",
    make: "",
    model: "",
  });

  async function loadVehicles() {
    setLoading(true);

    const { data, error } = await tenant
      .filterByTenant(supabase.from("vehicles").select("*"))
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      setVehicles([]);
    } else {
      setVehicles((data as Vehicle[]) || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadVehicles();
  }, [tenant.activeTenantId]);

  function resetForm() {
    setEditingId(null);
    setForm({
      registration: "",
      vehicle_type: "",
      make: "",
      model: "",
    });
  }

  function startEdit(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setMessage("");

    setForm({
      registration: vehicle.registration || "",
      vehicle_type: vehicle.vehicle_type || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveVehicle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!form.registration.trim()) {
      setMessage("Registration required");
      return;
    }

    if (!editingId && !tenant.writeTenantId) {
      setMessage("Pick a specific tenant to create records.");
      return;
    }

    setSaving(true);

    const payload = {
      registration: form.registration.trim().toUpperCase(),
      vehicle_type: form.vehicle_type.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
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
      const result = await supabase
        .from("vehicles")
        .insert([{ ...payload, tenant_id: tenant.writeTenantId, active: true }]);

      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save vehicle.");
      setSaving(false);
      return;
    }

    resetForm();
    setMessage(wasEditing ? "Vehicle updated" : "Vehicle created");
    await loadVehicles();
    setSaving(false);
  }

  async function deleteVehicle(id: string) {
    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!window.confirm("Delete vehicle?")) return;

    setMessage("");

    const { error } = await supabase
      .from("vehicles")
      .delete()
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Vehicle deleted");
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

    setMessage(!active ? "Vehicle activated" : "Vehicle deactivated");
    await loadVehicles();
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
          background: "rgba(0,0,0,0.6)",
          padding: 30,
          borderRadius: 20,
        }}
      >
        <h1 style={{ color: "white", marginTop: 0 }}>Vehicles</h1>

        {isAdmin ? (
        <form
          onSubmit={saveVehicle}
          style={{
            background: "white",
            padding: 20,
            borderRadius: 14,
            marginBottom: 20,
            display: "grid",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>
            {editingId ? "Edit Vehicle" : "Add Vehicle"}
          </h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={inputStyle}
              placeholder="Registration"
              value={form.registration}
              onChange={(e) =>
                setForm({ ...form, registration: e.target.value })
              }
            />

            <input
              style={inputStyle}
              placeholder="Vehicle type"
              value={form.vehicle_type}
              onChange={(e) =>
                setForm({ ...form, vehicle_type: e.target.value })
              }
            />

            <input
              style={inputStyle}
              placeholder="Make"
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Model"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
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
          {vehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              style={{
                background: "white",
                padding: 20,
                borderRadius: 14,
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>
                {vehicle.registration}
              </h3>

              <div style={{ opacity: 0.7 }}>
                {vehicle.vehicle_type || "No type"} • {vehicle.make || "-"}{" "}
                {vehicle.model || ""}
              </div>

              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
                Status: {vehicle.active ? "Active" : "Inactive"}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
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
                      onClick={() => deleteVehicle(vehicle.id)}
                    >
                      Delete
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => toggleVehicle(vehicle.id, vehicle.active)}
                >
                  {vehicle.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
    </TenantGate>
  );
}
