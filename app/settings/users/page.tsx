
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";

export default function UsersPage() {

    const supabase = createClient();
    const tenant = useTenant();
    const canInvite = tenant.role !== "staff";

    const [users, setUsers] = useState<any[]>([]);
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");

    async function loadUsers() {

        const { data } = await tenant
            .filterByTenant(supabase.from("profiles").select("*"));

        setUsers(data || []);

    }

    useEffect(() => {

        loadUsers();

    }, [tenant.activeTenantId]);

    async function inviteUser(e: any) {

        e.preventDefault();

        if (!canInvite) {
            setMessage("Only an admin can invite users.");
            return;
        }

        if (!tenant.writeTenantId) {
            setMessage("Pick a specific tenant to invite into.");
            return;
        }

        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
                data: { tenant_id: tenant.writeTenantId },
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

        <TenantGate>
        <main style={pageStyle}>

            <div style={overlayStyle}>

                <h1 style={titleStyle}>Users</h1>

                {canInvite && (

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

                )}

                <div style={gridStyle}>

                    {users.map(user => (

                        <div key={user.id} style={cardStyle}>

                            {user.email}

                        </div>

                    ))}

                </div>

            </div>

        </main>
        </TenantGate>

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
