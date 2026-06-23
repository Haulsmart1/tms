"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

const inputStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  minWidth: 160
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

export default function DriversPage() {

  const supabase = createClient();

  const [drivers, setDrivers] = useState<any[]>([]);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    licence_number: "",
    licence_category: "",
    qualifications: ""
  });

  async function loadDrivers() {

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    if (!error) setDrivers(data || []);

  }

  useEffect(() => {
    loadDrivers();
  }, []);

  function resetForm() {

    setEditingId(null);

    setForm({
      name: "",
      phone: "",
      email: "",
      licence_number: "",
      licence_category: "",
      qualifications: ""
    });

  }

  function startEdit(driver: any) {

    setEditingId(driver.id);

    setForm({
      name: driver.name || "",
      phone: driver.phone || "",
      email: driver.email || "",
      licence_number: driver.licence_number || "",
      licence_category: driver.licence_category || "",
      qualifications: driver.qualifications || ""
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

  }

  async function saveDriver(e: any) {

    e.preventDefault();

    if (!form.name) {
      setMessage("Driver name required");
      return;
    }

    const payload = {

      tenant_id: TENANT_ID,
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      licence_number: form.licence_number || null,
      licence_category: form.licence_category || null,
      qualifications: form.qualifications || null

    };

    let error;

    if (editingId) {

      ({ error } = await supabase
        .from("drivers")
        .update(payload)
        .eq("id", editingId));

    } else {

      ({ error } = await supabase
        .from("drivers")
        .insert([{ ...payload, active: true }]));

    }

    if (error) {
      setMessage(error.message);
      return;
    }

    resetForm();

    setMessage(
      editingId
        ? "Driver updated"
        : "Driver created"
    );

    loadDrivers();

  }

  async function deleteDriver(id: any) {

    if (!confirm("Delete driver?")) return;

    const { error } = await supabase
      .from("drivers")
      .delete()
      .eq("id", id);

    if (!error) {

      setMessage("Driver deleted");
      loadDrivers();

    }

  }

  async function toggleDriver(id: any, active: any) {

    await supabase
      .from("drivers")
      .update({ active: !active })
      .eq("id", id);

    loadDrivers();

  }

  return (

    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1494412574643-ff7f1b1a5d53')",
        backgroundSize: "cover"
      }}
    >

      <div
        style={{
          background: "rgba(0,0,0,0.6)",
          padding: 30,
          borderRadius: 20
        }}
      >

        <h1 style={{ color: "white" }}>
          Drivers
        </h1>

        <form
          onSubmit={saveDriver}
          style={{
            background: "white",
            padding: 20,
            borderRadius: 14,
            marginBottom: 20,
            display: "grid",
            gap: 12
          }}
        >

          <h2>
            {editingId ? "Edit Driver" : "Add Driver"}
          </h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

            <input
              style={inputStyle}
              placeholder="Driver name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Phone"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Licence number"
              value={form.licence_number}
              onChange={e => setForm({ ...form, licence_number: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Licence category"
              value={form.licence_category}
              onChange={e => setForm({ ...form, licence_category: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Qualifications"
              value={form.qualifications}
              onChange={e => setForm({ ...form, qualifications: e.target.value })}
            />

          </div>

          <div style={{ display: "flex", gap: 8 }}>

            <button style={buttonStyle}>
              {editingId ? "Update" : "Add"}
            </button>

            {editingId && (

              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={resetForm}
              >
                Cancel
              </button>

            )}

          </div>

        </form>

        {message && (

          <div
            style={{
              background: "white",
              padding: 12,
              borderRadius: 10,
              marginBottom: 20
            }}
          >
            {message}
          </div>

        )}

        <div style={{ display: "grid", gap: 16 }}>

          {drivers.map(driver => (

            <div
              key={driver.id}
              style={{
                background: "white",
                padding: 20,
                borderRadius: 14
              }}
            >

              <h3>{driver.name}</h3>

              <div style={{ opacity: .7 }}>

                {driver.phone} • {driver.email}

              </div>

              <div style={{ marginTop: 8 }}>

                Licence: {driver.licence_number || "-"}
                <br />

                Category: {driver.licence_category || "-"}
                <br />

                Qualifications: {driver.qualifications || "-"}

              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 10,
                  flexWrap: "wrap"
                }}
              >

                <button
                  style={secondaryButtonStyle}
                  onClick={() => startEdit(driver)}
                >
                  Edit
                </button>

                <button
                  style={deleteButtonStyle}
                  onClick={() => deleteDriver(driver.id)}
                >
                  Delete
                </button>

                <button
                  style={secondaryButtonStyle}
                  onClick={() => toggleDriver(driver.id, driver.active)}
                >
                  {driver.active ? "Deactivate" : "Activate"}
                </button>

              </div>

            </div>

          ))}

        </div>

      </div>

    </main>

  );

}

