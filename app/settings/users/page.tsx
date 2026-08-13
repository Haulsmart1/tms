"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";

type TenantUser = {
  membership_id: string;
  user_id: string | null;
  tenant_id: string;
  role: string;
  membership_created_at: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  company_id: string | null;
  role_id: string | null;
};

export default function UsersPage() {
  const tenant = useTenant();
  const canInvite = tenant.role === "admin" || tenant.role === "super_admin";

  const [users, setUsers] = useState<TenantUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!tenant.activeTenantId) {
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `/api/settings/users/invite?tenantId=${encodeURIComponent(
          tenant.activeTenantId
        )}`,
        { cache: "no-store" }
      );

      const body = (await response.json()) as {
        users?: TenantUser[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to load tenant users.");
      }

      setUsers(body.users ?? []);
    } catch (error) {
      setUsers([]);
      setMessage(
        error instanceof Error ? error.message : "Unable to load tenant users."
      );
    } finally {
      setLoading(false);
    }
  }, [tenant.activeTenantId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

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
        headers: { "Content-Type": "application/json" },
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
        error instanceof Error ? error.message : "Unable to invite user."
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
                <div key={user.membership_id} style={cardStyle}>
                  <div style={userHeaderStyle}>
                    <div>
                      <strong style={{ fontSize: 18 }}>
                        {user.full_name || user.email || "TMS User"}
                      </strong>

                      {user.email ? (
                        <div style={mutedStyle}>{user.email}</div>
                      ) : null}

                      {user.phone ? (
                        <div style={mutedStyle}>{user.phone}</div>
                      ) : null}
                    </div>

                    <span style={roleBadgeStyle}>
                      {formatRole(user.role)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </TenantGate>
  );
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

const titleStyle = { color: "white" };

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

const fieldStyle = { display: "grid", gap: 6 };

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

const gridStyle = { display: "grid", gap: 12 };

const userHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const mutedStyle = {
  marginTop: 5,
  color: "#64748b",
};

const roleBadgeStyle = {
  padding: "6px 10px",
  borderRadius: 999,
  background: "#e0e7ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 800,
};
