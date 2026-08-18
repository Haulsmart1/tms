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

        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Admin</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Permissions</h1>
                </header>

                {users.map(user => (

                    <article key={user.id} className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-sm">

                        <h3 className="mb-2 text-md font-semibold text-ink">{user.email}</h3>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">

                            {pages.map(p => (

                                <label key={p} className="flex items-center gap-2 text-sm text-ink-2">

                                    <input
                                        type="checkbox"
                                        onChange={() => toggle(user.id, p)}
                                    />

                                    {p}

                                </label>

                            ))}

                        </div>

                    </article>

                ))}

            </main>
        </div>

    )

}
