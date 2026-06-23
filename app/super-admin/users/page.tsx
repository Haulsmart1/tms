"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

type ProfileRow = {
    id: string;
    tenant_id: string | null;
    full_name: string | null;
    created_at: string | null;
    roles?: { name: string }[] | null;
};

type UserRow = {
    id: string;
    tenant_id: string | null;
    full_name: string | null;
    created_at: string | null;
    role: string | null;
};

export default function SuperAdminUsersPage() {
    const supabase = createClient();

    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadUsers() {
        setLoading(true);
        setMessage("");

        const { data, error } = await supabase
            .from("profiles")
            .select(`
        id,
        tenant_id,
        full_name,
        created_at,
        roles (
          name
        )
      `)
            .order("created_at", { ascending: false });

        if (error) {
            setMessage(error.message);
            setUsers([]);
            setLoading(false);
            return;
        }

        const normalizedUsers: UserRow[] = (data ?? []).map((user: ProfileRow) => ({
            id: user.id,
            tenant_id: user.tenant_id,
            full_name: user.full_name,
            created_at: user.created_at,
            role: user.roles?.[0]?.name ?? null,
        }));

        setUsers(normalizedUsers);
        setLoading(false);
    }

    useEffect(() => {
        loadUsers();
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
                <h1 style={{ color: "white", marginTop: 0 }}>All Users</h1>

                {message ? (
                    <div style={{ background: "white", padding: 20, borderRadius: 14, marginBottom: 16 }}>
                        {message}
                    </div>
                ) : null}

                {loading ? (
                    <div style={{ background: "white", padding: 20, borderRadius: 14, marginBottom: 16 }}>
                        Loading...
                    </div>
                ) : null}

                {!loading && users.length === 0 ? (
                    <div style={{ background: "white", padding: 20, borderRadius: 14, marginBottom: 16 }}>
                        No users found.
                    </div>
                ) : null}

                <div style={{ display: "grid", gap: 16 }}>
                    {users.map((user) => (
                        <div
                            key={user.id}
                            style={{
                                background: "white",
                                padding: 20,
                                borderRadius: 14,
                            }}
                        >
                            <h3 style={{ marginTop: 0 }}>{user.full_name || user.id}</h3>
                            <div style={{ opacity: 0.7 }}>Tenant: {user.tenant_id || "-"}</div>
                            <div style={{ opacity: 0.7 }}>Role: {user.role || "-"}</div>
                            <div style={{ opacity: 0.7 }}>User ID: {user.id}</div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
