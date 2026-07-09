
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

const FALLBACK_TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

export default function UsersPage() {

    const supabase = createClient();

    const [tenantId, setTenantId] = useState<string | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");

    async function loadTenant() {

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            setTenantId(FALLBACK_TENANT_ID);
            return FALLBACK_TENANT_ID;
        }

        const { data } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("id", user.id)
            .single();

        const id = data?.tenant_id || FALLBACK_TENANT_ID;

        setTenantId(id);

        return id;

    }

    async function loadUsers(id: string) {

        const { data } = await supabase
            .from("profiles")
            .select("*")
            .eq("tenant_id", id);

        setUsers(data || []);

    }

    useEffect(() => {

        async function init() {

            const id = await loadTenant();

            await loadUsers(id);

        }

        init();

    }, []);

    async function inviteUser(e: any) {

        e.preventDefault();

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
            },
        });

        if (error) {
            setMessage(error.message);
        } else {
            setMessage("Invite sent");
            setEmail("");
        }

    }

    return (

        <main style={pageStyle}>

            <div style={overlayStyle}>

                <h1 style={titleStyle}>Users</h1>

                <form onSubmit={inviteUser} style={cardStyle}>

                    <input
                        placeholder="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={inputStyle}
                    />

                    <button style={buttonStyle}>
                        Invite user
                    </button>

                </form>

                <div style={gridStyle}>

                    {users.map(user => (

                        <div key={user.id} style={cardStyle}>

                            {user.email}

                        </div>

                    ))}

                </div>

            </div>

        </main>

    );

}

const pageStyle = {
    minHeight: "100vh",
    padding: 30,
    backgroundImage: "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
    backgroundSize: "cover"
}

const overlayStyle = {
    background: "rgba(0,0,0,0.65)",
    padding: 30,
    borderRadius: 20
}

const titleStyle = {
    color: "white"
}

const cardStyle = {
    background: "white",
    padding: 20,
    borderRadius: 14,
    marginBottom: 20
}

const gridStyle = {
    display: "grid",
    gap: 20
}

const inputStyle = {
    padding: 12,
    borderRadius: 10,
    border: "1px solid #ddd"
}

const buttonStyle = {
    padding: 12,
    borderRadius: 10,
    border: "none",
    background: "#111",
    color: "white"
}
