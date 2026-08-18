"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import Button from "../../../components/Button";
import Badge from "../../../components/Badge";

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

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState("staff");
  const [savingUser, setSavingUser] = useState(false);

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

  function beginEdit(user: TenantUser) {
    if (!canInvite || !user.user_id) {
      return;
    }

    setMessage("");
    setEditingUserId(user.user_id);
    setEditFullName(user.full_name ?? "");
    setEditPhone(user.phone ?? "");
    setEditRole(user.role || "staff");
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditFullName("");
    setEditPhone("");
    setEditRole("staff");
  }

  async function saveUser(userId: string) {
    if (!canInvite) {
      setMessage("Only an admin can edit tenant users.");
      return;
    }

    if (!tenant.writeTenantId) {
      setMessage("Pick a specific tenant before editing users.");
      return;
    }

    setSavingUser(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/settings/users/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: tenant.writeTenantId,
            fullName: editFullName,
            phone: editPhone,
            role: editRole,
          }),
        }
      );

      const body = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to update tenant user.");
      }

      setMessage("User updated.");
      cancelEdit();
      await loadUsers();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update tenant user."
      );
    } finally {
      setSavingUser(false);
    }
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Settings</div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Users
            </h1>
            <p className="text-sm text-ink-3">
              Invite users and manage tenant roles and contact details.
            </p>
          </header>

          {canInvite ? (
            <form
              onSubmit={inviteUser}
              className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <h2 className="mb-3 mt-0 text-md font-semibold text-ink">
                Invite User
              </h2>

              <div className="grid items-end gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Email</span>
                  <input
                    type="email"
                    required
                    placeholder="user@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Role</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                  >
                    <option value="staff">Staff</option>
                    <option value="driver">Driver</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                <div>
                  <Button type="submit" disabled={inviting}>
                    {inviting ? "Sending..." : "Invite User"}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

          {message ? (
            <div className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm text-ink shadow-sm">
              {message}
            </div>
          ) : null}

          <div className="grid gap-3">
            {loading ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                No users found for this tenant.
              </div>
            ) : (
              users.map((user) => {
                const isEditing =
                  Boolean(user.user_id) &&
                  editingUserId === user.user_id;

                return (
                  <article
                    key={user.membership_id}
                    className="rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="break-words text-md font-semibold text-ink">
                          {user.full_name || user.email || "TMS User"}
                        </strong>

                        {user.email ? (
                          <div className="mt-1 break-words text-sm text-ink-3">
                            {user.email}
                          </div>
                        ) : null}

                        {user.phone ? (
                          <div className="mt-1 break-words text-sm text-ink-3">
                            {user.phone}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="info">{formatRole(user.role)}</Badge>

                        {canInvite && user.user_id ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              isEditing
                                ? cancelEdit()
                                : beginEdit(user)
                            }
                          >
                            {isEditing ? "Cancel" : "Edit"}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {isEditing && user.user_id ? (
                      <div className="mt-3 grid items-end gap-3 border-t border-line pt-3 sm:grid-cols-2">
                        <label className="grid gap-1.5">
                          <span className="text-sm font-medium text-ink-2">
                            Full name
                          </span>
                          <input
                            value={editFullName}
                            onChange={(event) =>
                              setEditFullName(event.target.value)
                            }
                            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                            placeholder="Full name"
                          />
                        </label>

                        <label className="grid gap-1.5">
                          <span className="text-sm font-medium text-ink-2">
                            Phone
                          </span>
                          <input
                            value={editPhone}
                            onChange={(event) =>
                              setEditPhone(event.target.value)
                            }
                            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                            placeholder="Phone number"
                          />
                        </label>

                        <label className="grid gap-1.5">
                          <span className="text-sm font-medium text-ink-2">
                            Tenant role
                          </span>
                          <select
                            value={editRole}
                            onChange={(event) =>
                              setEditRole(event.target.value)
                            }
                            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                          >
                            <option value="staff">Staff</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>

                        <div>
                          <Button
                            type="button"
                            disabled={savingUser}
                            onClick={() => void saveUser(user.user_id!)}
                          >
                            {savingUser ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </main>
      </div>
    </TenantGate>
  );
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
