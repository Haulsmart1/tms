"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "white",
  minWidth: 160,
  boxSizing: "border-box"
};

const buttonStyle = {
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

export default function SubcontractorsPage() {
  const supabase = createClient();

  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    vehicle_reg: "",
    vehicle_type: "",
    driver_name: "",
    location: "",
    address: "",
    email: "",
    phone: ""
  });

  async function loadSubcontractors() {
    const { data, error } = await supabase
      .from("subcontractors")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Load error: ${error.message}`);
      return;
    }

    setSubcontractors(data || []);
  }

  useEffect(() => {
    loadSubcontractors();
  }, []);

  async function createSubcontractor(event: any) {
    event.preventDefault();
    setMessage("");

    const name = form.name.trim();

    if (!name) {
      setMessage("Subcontractor name is required.");
      return;
    }

    const { error } = await supabase
      .from("subcontractors")
      .insert([
        {
          tenant_id: TENANT_ID,
          name,
          vehicle_reg: form.vehicle_reg.trim() || null,
          vehicle_type: form.vehicle_type.trim() || null,
          driver_name: form.driver_name.trim() || null,
          location: form.location.trim() || null,
          address: form.address.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          active: true
        }
      ]);

    if (error) {
      setMessage(`Create error: ${error.message}`);
      return;
    }

    setForm({
      name: "",
      vehicle_reg: "",
      vehicle_type: "",
      driver_name: "",
      location: "",
      address: "",
      email: "",
      phone: ""
    });

    setMessage("Subcontractor added.");
    await loadSubcontractors();
  }

  async function toggleSubcontractor(id: any, active: any) {
    const { error } = await supabase
      .from("subcontractors")
      .update({ active: !active })
      .eq("id", id);

    if (error) {
      setMessage(`Update error: ${error.message}`);
      return;
    }

    await loadSubcontractors();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1601584115197-04ecc0da31d7')",
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
          <h1 style={{ marginTop: 0, fontSize: 38 }}>Subcontractors</h1>
          <p style={{ opacity: 0.85, marginBottom: 0 }}>
            Manage outsourced vehicles, drivers, and contact details.
          </p>
        </div>

        <form
          onSubmit={createSubcontractor}
          style={{
            display: "grid",
            gap: 16,
            maxWidth: 1100,
            marginBottom: 24,
            background: "rgba(255,255,255,0.95)",
            padding: 24,
            borderRadius: 16,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)"
          }}
        >
          <h2 style={{ margin: 0 }}>Add Subcontractor</h2>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={inputStyle}
              placeholder="Subcontractor name"
              value={form.name}
              onChange={(e: any) => setForm({ ...form, name: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Vehicle reg"
              value={form.vehicle_reg}
              onChange={(e: any) => setForm({ ...form, vehicle_reg: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Vehicle type"
              value={form.vehicle_type}
              onChange={(e: any) => setForm({ ...form, vehicle_type: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Driver name"
              value={form.driver_name}
              onChange={(e: any) => setForm({ ...form, driver_name: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={inputStyle}
              placeholder="Location"
              value={form.location}
              onChange={(e: any) => setForm({ ...form, location: e.target.value })}
            />
            <input
              style={{ ...inputStyle, minWidth: 260 }}
              placeholder="Address"
              value={form.address}
              onChange={(e: any) => setForm({ ...form, address: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Email"
              value={form.email}
              onChange={(e: any) => setForm({ ...form, email: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Phone number"
              value={form.phone}
              onChange={(e: any) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div>
            <button type="submit" style={buttonStyle}>
              Add Subcontractor
            </button>
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
          {subcontractors.map((subcontractor: any) => (
            <div
              key={subcontractor.id}
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
                  marginBottom: 16
                }}
              >
                <div>
                  <h2 style={{ margin: "0 0 8px 0" }}>{subcontractor.name}</h2>
                  <div style={{ color: "#4b5563" }}>
                    Status: {subcontractor.active ? "Active" : "Inactive"}
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() =>
                      toggleSubcontractor(
                        subcontractor.id,
                        subcontractor.active
                      )
                    }
                  >
                    Toggle
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12
                }}
              >
                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Vehicle Reg</strong>
                  <div>{subcontractor.vehicle_reg || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Vehicle Type</strong>
                  <div>{subcontractor.vehicle_type || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Driver</strong>
                  <div>{subcontractor.driver_name || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Location</strong>
                  <div>{subcontractor.location || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Address</strong>
                  <div>{subcontractor.address || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Email</strong>
                  <div>{subcontractor.email || "-"}</div>
                </div>

                <div style={{ background: "#f9fafb", padding: 12, borderRadius: 12 }}>
                  <strong>Phone</strong>
                  <div>{subcontractor.phone || "-"}</div>
                </div>
              </div>
            </div>
          ))}

          {subcontractors.length === 0 ? (
            <div
              style={{
                background: "rgba(255,255,255,0.95)",
                padding: 22,
                borderRadius: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)"
              }}
            >
              No subcontractors yet.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}



