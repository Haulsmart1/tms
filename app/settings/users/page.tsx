"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import Button from "../../../components/Button";
import { tenantDataView } from "../../../lib/loading/tenantDataView";
import UserCard from "./UserCard";
import type { TenantUser } from "./types";

const SKELETON_CARDS = 4;

/* One field, because no field is read while loading: every read in the card
   sits behind the `loading` branch. A fuller object would be a second copy of
   "which fields the card reads", drifting silently the first time the card
   reads one more. */
const PLACEHOLDER_USER = { membership_id: "skeleton" } as TenantUser;

export default function UsersPage() {
  const tenant = useTenant();
  const canInvite = tenant.role === "admin" || tenant.role === "super_admin";

  const [users, setUsers] = useState<TenantUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  /* Separate from `message`, which also carries invite and save results.
     Only a failed READ may suppress the empty state. */
  const [loadFailed, setLoadFailed] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState("staff");
  const [savingUser, setSavingUser] = useState(false);

  const loadUsers = useCallback(async () => {
    if (tenant.status !== "ready") return;   // stay in the loading view

    if (!tenant.activeTenantId) {
      // A resolved admin on "All tenants". Nothing is coming, and the view
      // says so rather than claiming the tenant has no users.
      setUsers([]);
      setLoadFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadFailed(false);

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
      setLoadFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to load tenant users."
      );
    } finally {
      setLoading(false);
    }
  }, [tenant.status, tenant.activeTenantId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const view = tenantDataView({
    tenantStatus: tenant.status,
    activeTenantId: tenant.activeTenantId,
    fetching: loading,
    hasData: users.length > 0,
    failed: loadFailed,
  });

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
              <h2 className="mb-3 text-md font-semibold text-ink">
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

          <div className="grid gap-3" aria-busy={view === "loading"}>
            {view === "loading" ? (
              <span className="sr-only" role="status">Loading users</span>
            ) : null}

            {view === "loading" ? (
              Array.from({ length: SKELETON_CARDS }, (_, index) => (
                <UserCard
                  key={`skeleton-${index}`}
                  user={PLACEHOLDER_USER}
                  loading
                  canInvite={canInvite}
                  edit={null}
                  onBeginEdit={() => {}}
                />
              ))
            ) : view === "no-tenant-selected" ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                Users are managed one tenant at a time. Pick a tenant from the
                selector in the header to see and invite its users.
              </div>
            ) : view === "error" ? (
              /* Deliberately nothing. The failure is already on screen in the
                 `message` banner above; a second copy here would be noise.
                 The point of the branch is to suppress the empty card, which
                 would otherwise call a failed read an empty tenant. */
              null
            ) : view === "empty" ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                No users found for this tenant.
              </div>
            ) : (
              users.map((user) => (
                <UserCard
                  key={user.membership_id}
                  user={user}
                  canInvite={canInvite}
                  edit={
                    user.user_id && editingUserId === user.user_id
                      ? {
                          fullName: editFullName,
                          setFullName: setEditFullName,
                          phone: editPhone,
                          setPhone: setEditPhone,
                          role: editRole,
                          setRole: setEditRole,
                          saving: savingUser,
                          onSave: () => void saveUser(user.user_id!),
                          onCancel: cancelEdit,
                        }
                      : null
                  }
                  onBeginEdit={beginEdit}
                />
              ))
            )}
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
