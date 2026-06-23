"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

const pages = [
    "dashboard",
    "jobs",
    "pod",
    "invoices",
    "customers",
    "subcontractors",
    "vehicles",
    "drivers",
    "tracking",
    "assets",
    "tachograph",
    "telematics",
    "maintenance"
];

export default function PermissionsPage() {

    const supabase = createClient();

    const [users, setUsers] = useState<any[]>([]);
    const [message, setMessage] = useState("");

    useEffect(() => {

        loadUsers();

    }, []);

    async function loadUsers() {

        const { data } = await supabase
            .from("profiles")
            .select("*");

        setUsers(data || []);

    }

    async function toggle(userId: string, page: string) {

        await supabase
            .from("user_permissions")
            .upsert({
                user_id: userId,
                page
            });

        setMessage("updated");

    }

    return (

        <main style={pageStyle}>

            <div style={overlayStyle}>

                <h1 style={titleStyle}>Permissions</h1>

                {users.map(user => (

                    <div key={user.id} style={cardStyle}>

                        <h3>{user.email}</h3>

                        <div style={gridStyle}>

                            {pages.map(p => (

                                <label key={p}>

                                    <input
                                        type="checkbox"
                                        onChange={() => toggle(user.id, p)}
                                    />

                                    {p}

                                </label>

                            ))}

                        </div>

                    </div>

                ))}

            </div>

        </main>

    )

}

const pageStyle = { minHeight: "100vh", padding: 30, backgroundImage: "url('https://images.unsplash.com/photo-1553413077-190dd305871c')", backgroundSize: "cover" }

const overlayStyle = { background: "rgba(0,0,0,0.65)", padding: 30, borderRadius: 20 }

const titleStyle = { color: "white" }

const cardStyle = { background: "white", padding: 20, borderRadius: 14, marginBottom: 20 }

const gridStyle = { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }
