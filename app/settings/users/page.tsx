"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";

type ProfileRow = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  tenant_id?: string | null;
};

export default function UsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const canInvite =
    tenant.role === "admin" || tenant.role === "super_admin";

  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  async function loadUsers() {
    setLoading(true);

    const { data, error } = await tenant.filterByTenant(
      supabase
        .from("profiles")
        .select("id, email, full_name, tenant_id")
        .order("full_name", { ascending: true })
    );

    if (error) {
      setMessage(error.message);
      setUsers([]);
    } else {
      setUsers((data as ProfileRow[]) || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.activeTenantId]);

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!canInvite) {
      setMessage("Only an admin can invite users.");
      return;
    }

    if (!tenant.writeTenantId) {
      setMessage("Pick a specific tenant to invite into.");
      return;
    }

    if (!email.trim()) {
      setMessage("Enter an email address.");
      return;
    }

    setInviting(true);

    try {
      const response = await fetch("/api/settings/users/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          role,
          tenantId: tenant.writeTenantId,
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to invite user.");
      }

      setMessage(body.message || "Invite sent.");
      setEmail("");
      setRole("staff");

      await loadUsers();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to invite user."
      );
    } finally {
      setInviting(false);
    }
  }

  return (
    <TenantGate>
      <main style={pageStyle}>
        <div style={overlayStyle}>
          <h1 style={titleStyle}>Users</h1>

          {canInvite ? (
            <form onSubmit={inviteUser} style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Invite User</h2>

              <div style={formGridStyle}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Email</span>
                  <input
                    type="email"
                    required
                    placeholder="user@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    style={inputStyle}
                  />
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>Role</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    style={inputStyle}
                  >
                    <option value="staff">Staff</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={inviting}
                  style={{
                    ...buttonStyle,
                    opacity: inviting ? 0.65 : 1,
                    cursor: inviting ? "wait" : "pointer",
                  }}
                >
                  {inviting ? "Sending..." : "Invite User"}
                </button>
              </div>
            </form>
          ) : null}

          {message ? <div style={messageStyle}>{message}</div> : null}

          <div style={gridStyle}>
            {loading ? (
              <div style={cardStyle}>Loading users...</div>
            ) : users.length === 0 ? (
              <div style={cardStyle}>No users found for this tenant.</div>
            ) : (
              users.map((user) => (
                <div key={user.id} style={cardStyle}>
                  <strong>
                    {user.full_name || user.email || "TMS User"}
                  </strong>

                  {user.email ? (
                    <div style={{ marginTop: 6, color: "#64748b" }}>
                      {user.email}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </TenantGate>
  );
}

const pageStyle = {
  minHeight: "100vh",
  padding: 30,
  backgroundImage:
    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
  backgroundSize: "cover",
  backgroundPosition: "center",
};

const overlayStyle = {
  background: "rgba(0,0,0,0.65)",
  padding: 30,
  borderRadius: 20,
};

const titleStyle = {
  color: "white",
};

const cardStyle = {
  background: "white",
  padding: 20,
  borderRadius: 14,
  marginBottom: 20,
};

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
  alignItems: "end",
};

const fieldStyle = {
  display: "grid",
  gap: 6,
};

const labelStyle = {
  fontSize: 12,
  fontWeight: 800,
  color: "#475569",
};

const inputStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
};

const buttonStyle = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
};

const messageStyle = {
  background: "white",
  padding: 12,
  borderRadius: 10,
  marginBottom: 20,
};

const gridStyle = {
  display: "grid",
  gap: 12,
};
