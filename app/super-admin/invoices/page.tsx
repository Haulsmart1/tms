"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

export default function SuperAdminInvoicesPage() {
    const supabase = createClient();

    const [invoices, setInvoices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadInvoices() {
        setLoading(true);

        const { data, error } = await supabase
            .from("invoices")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            setMessage(error.message);
        }

        setInvoices(data || []);
        setLoading(false);
    }

    useEffect(() => {
        loadInvoices();
    }, []);

    async function markStatus(id: string, status: string) {
        const { error } = await supabase
            .from("invoices")
            .update({ status })
            .eq("id", id);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage(`Invoice marked ${status}.`);
        await loadInvoices();
    }

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 30,
                backgroundImage:
                    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
                backgroundSize: "cover",
                backgroundPosition: "center",
            }}
        >
            <div
                style={{
                    background: "rgba(0,0,0,0.65)",
                    padding: 30,
                    borderRadius: 20,
                }}
            >
                <h1 style={{ color: "white", marginTop: 0 }}>Invoices</h1>

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
                    <div style={{ background: "white", padding: 20, borderRadius: 14 }}>
                        Loading...
                    </div>
                ) : null}

                <div style={{ display: "grid", gap: 16 }}>
                    {invoices.map((invoice) => (
                        <div
                            key={invoice.id}
                            style={{
                                background: "white",
                                padding: 20,
                                borderRadius: 14,
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>Invoice #{invoice.id.slice(0, 8)}</h3>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Company ID: {invoice.company_id}
                            </div>
                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Vehicles: {invoice.vehicle_count}
                            </div>
                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Amount: £{invoice.amount}
                            </div>
                            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                Status: {invoice.status}
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    onClick={() => markStatus(invoice.id, "paid")}
                                    style={{
                                        padding: "10px 14px",
                                        borderRadius: 10,
                                        border: "none",
                                        background: "#111827",
                                        color: "white",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    Mark Paid
                                </button>

                                <button
                                    type="button"
                                    onClick={() => markStatus(invoice.id, "pending")}
                                    style={{
                                        padding: "10px 14px",
                                        borderRadius: 10,
                                        border: "1px solid #d1d5db",
                                        background: "white",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                    }}
                                >
                                    Mark Pending
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
