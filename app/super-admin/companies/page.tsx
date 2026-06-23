"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

export default function SuperAdminCompaniesPage() {
    const supabase = createClient();

    const [companies, setCompanies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadCompanies() {
        setLoading(true);

        const { data } = await supabase
            .from("companies")
            .select("*")
            .order("name", { ascending: true });

        setCompanies(data || []);
        setLoading(false);
    }

    useEffect(() => {
        loadCompanies();
    }, []);

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
                <h1 style={{ color: "white", marginTop: 0 }}>Companies</h1>

                {loading ? (
                    <div style={{ background: "white", padding: 20, borderRadius: 14 }}>
                        Loading...
                    </div>
                ) : null}

                <div style={{ display: "grid", gap: 16 }}>
                    {companies.map((company) => (
                        <div
                            key={company.id}
                            style={{
                                background: "white",
                                padding: 20,
                                borderRadius: 14,
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>{company.name}</h3>
                            <div style={{ opacity: 0.7 }}>ID: {company.id}</div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
