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

export default function CustomersPage() {
  const supabase = createClient();

  const [customers, setCustomers] = useState<any[]>([]);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    phone: "",
    email: "",
    vat_number: ""
  });

  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setCustomers(data || []);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({
      name: "",
      contact_name: "",
      phone: "",
      email: "",
      vat_number: ""
    });
  }

  function startEdit(customer: any) {
    setEditingId(customer.id);
    setForm({
      name: customer.name || "",
      contact_name: customer.contact_name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      vat_number: customer.vat_number || ""
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveCustomer(e: any) {
    e.preventDefault();

    if (!form.name.trim()) {
      setMessage("Customer name required");
      return;
    }

    const payload = {
      tenant_id: TENANT_ID,
      name: form.name,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      vat_number: form.vat_number || null
    };

    let error;

    if (editingId) {
      ({ error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", editingId));
    } else {
      ({ error } = await supabase
        .from("customers")
        .insert([{ ...payload, active: true }]));
    }

    if (error) {
      setMessage(error.message);
      return;
    }

    resetForm();
    setMessage(editingId ? "Customer updated" : "Customer created");
    await loadCustomers();
  }

  async function deleteCustomer(id: any) {
    if (!confirm("Delete this customer?")) return;

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Customer deleted");
    await loadCustomers();
  }

  async function toggleCustomer(id: any, active: any) {
    await supabase
      .from("customers")
      .update({ active: !active })
      .eq("id", id);

    await loadCustomers();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1556740738-b6a63e27c4df')",
        backgroundSize: "cover"
      }}
    >
      <div style={{ background: "rgba(0,0,0,0.6)", padding: 30, borderRadius: 20 }}>

        <h1 style={{ color: "white" }}>Customers</h1>

        <form
          onSubmit={saveCustomer}
          style={{
            background: "white",
            padding: 20,
            borderRadius: 14,
            marginBottom: 20,
            display: "grid",
            gap: 12
          }}
        >
          <h2>{editingId ? "Edit Customer" : "Add Customer"}</h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

            <input
              style={inputStyle}
              placeholder="Customer name"
              value={form.name}
              onChange={(e: any) => setForm({ ...form, name: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Contact"
              value={form.contact_name}
              onChange={(e: any) => setForm({ ...form, contact_name: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Phone"
              value={form.phone}
              onChange={(e: any) => setForm({ ...form, phone: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="Email"
              value={form.email}
              onChange={(e: any) => setForm({ ...form, email: e.target.value })}
            />

            <input
              style={inputStyle}
              placeholder="VAT"
              value={form.vat_number}
              onChange={(e: any) => setForm({ ...form, vat_number: e.target.value })}
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
          <div style={{
            background: "white",
            padding: 12,
            borderRadius: 10,
            marginBottom: 20
          }}>
            {message}
          </div>
        )}

        <div style={{ display: "grid", gap: 16 }}>

          {customers.map(customer => (

            <div
              key={customer.id}
              style={{
                background: "white",
                padding: 20,
                borderRadius: 14
              }}
            >

              <h3>{customer.name}</h3>

              <div style={{ opacity: .7, marginBottom: 10 }}>
                {customer.contact_name} • {customer.phone}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>

                <button
                  style={secondaryButtonStyle}
                  onClick={() => startEdit(customer)}
                >
                  Edit
                </button>

                <button
                  style={deleteButtonStyle}
                  onClick={() => deleteCustomer(customer.id)}
                >
                  Delete
                </button>

                <button
                  style={secondaryButtonStyle}
                  onClick={() => toggleCustomer(customer.id, customer.active)}
                >
                  {customer.active ? "Deactivate" : "Activate"}
                </button>

              </div>

            </div>

          ))}

        </div>

      </div>
    </main>
  );
}

