"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import Button from "../../../components/Button";
import MessageBanner from "../../../components/MessageBanner";
import Select from "../../../components/Select";
import { tenantDataView } from "../../../lib/loading/tenantDataView";
import { canManageListedUser } from "../../../lib/tenant/userAdmin";
import UserCard from "./UserCard";
import type { TenantUser } from "./types";

const SKELETON_CARDS = 4;

/* One field, because no field is read while loading: every read in the card
   sits behind the `loading` branch. A fuller object would be a second copy of
   "which fields the card reads", drifting silently the first time the card
   reads one more. */
const PLACEHOLDER_USER = { membership_id: "skeleton" } as TenantUser;

async function readJson(response: Response): Promise<{ error?: string; message?: string; users?: TenantUser[] }> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

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
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState("staff");
  const [savingUser, setSavingUser] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  /* SET-18: latest request wins. A slow response for the tenant the admin
     just switched away from must not replace the new tenant's list. */
  const loadSeqRef = useRef(0);

  const loadUsers = useCallback(async () => {
    if (tenant.status !== "ready") return;   // stay in the loading view

    const seq = ++loadSeqRef.current;
    const requestedTenantId = tenant.activeTenantId;

    if (!requestedTenantId) {
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
        `/api/settings/users/invite?tenantId=${encodeURIComponent(requestedTenantId)}`,
        { cache: "no-store" }
      );

      const body = await readJson(response);

      if (!response.ok) {
        throw new Error(body.error || "Unable to load tenant users.");
      }

      if (seq !== loadSeqRef.current) return;
      setUsers(body.users ?? []);
      setDataTenantId(requestedTenantId);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setUsers([]);
      setLoadFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to load tenant users."
      );
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
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
    dataTenantId,
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

      const body = await readJson(response);

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
    if (!canManageListedUser(tenant.role, user.role) || !user.user_id) {
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

      const body = await readJson(response);

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

  async function removeUser(user: TenantUser) {
    if (!user.user_id || !tenant.writeTenantId) {
      setMessage("Pick a specific tenant before removing users.");
      return;
    }

    const label = user.full_name || user.email || "this user";
    if (
      !window.confirm(
        `Remove ${label} from the company? They lose access to every tenant immediately.`
      )
    ) {
      return;
    }

    setRemovingUserId(user.user_id);
    setMessage("");

    try {
      const response = await fetch(
        `/api/settings/users/${encodeURIComponent(user.user_id)}?tenantId=${encodeURIComponent(
          tenant.writeTenantId
        )}`,
        { method: "DELETE" }
      );

      const body = await readJson(response);

      if (!response.ok) {
        throw new Error(body.error || "Unable to remove the user.");
      }

      if (editingUserId === user.user_id) cancelEdit();
      setMessage(`${label} was removed.`);
      await loadUsers();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to remove the user."
      );
    } finally {
      setRemovingUserId(null);
    }
  }

  const ownEmail = tenant.userEmail?.trim().toLowerCase() ?? null;

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
              Invite users and manage company roles and contact details.
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

                <Select
                  id="invite-role"
                  label="Role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option value="staff">Staff</option>
                  <option value="driver">Driver</option>
                  <option value="admin">Admin</option>
                </Select>

                <div>
                  <Button type="submit" disabled={inviting}>
                    {inviting ? "Sending..." : "Invite User"}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

          {/* tone="neutral" preserves this banner's existing look: it carries
              both the invite-sent confirmation and any failure text, so it is
              not a success-only region. */}
          <MessageBanner tone="neutral">{message}</MessageBanner>

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
                  canManage={canInvite}
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
                  canManage={canManageListedUser(tenant.role, user.role)}
                  canRemove={
                    !ownEmail || (user.email ?? "").trim().toLowerCase() !== ownEmail
                  }
                  removing={removingUserId === user.user_id}
                  onRemove={(target) => void removeUser(target)}
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
