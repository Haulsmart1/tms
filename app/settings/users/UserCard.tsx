import Button from "../../../components/Button";
import Badge from "../../../components/Badge";
import Skeleton from "../../../components/Skeleton";
import type { TenantUser } from "./types";

type Props = {
  user: TenantUser;
  loading?: boolean;
  canInvite: boolean;
  isEditing: boolean;
  /* The edit form lives inside the card, so its state comes in as props
     rather than being duplicated here. All of it stays owned by the page. */
  editFullName: string;
  setEditFullName: (value: string) => void;
  editPhone: string;
  setEditPhone: (value: string) => void;
  editRole: string;
  setEditRole: (value: string) => void;
  savingUser: boolean;
  onBeginEdit: (user: TenantUser) => void;
  onCancelEdit: () => void;
  onSave: (userId: string) => void;
};

/* ONE layout definition for both states, per the batch 1 decision. A separate
   skeleton component mirroring these class names drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the Edit
   button render for real; the button is merely disabled. */
export default function UserCard({
  user,
  loading = false,
  canInvite,
  isEditing,
  editFullName,
  setEditFullName,
  editPhone,
  setEditPhone,
  editRole,
  setEditRole,
  savingUser,
  onBeginEdit,
  onCancelEdit,
  onSave,
}: Props) {
  return (
    <article
      className="rounded-lg border border-line bg-surface-2 p-3"
      aria-busy={loading}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="break-words text-md font-semibold text-ink">
            {loading ? (
              <Skeleton display="inline-block" w="12ch" h="1rem" />
            ) : (
              user.full_name || user.email || "TMS User"
            )}
          </strong>

          {/* Email and phone render conditionally once the data is in, but
              unconditionally while loading: we cannot know yet whether they
              will be there, and a card that grows on arrival is worse than
              one that holds its height. */}
          {loading ? (
            <div className="mt-1 break-words text-sm text-ink-3">
              <Skeleton display="inline-block" w="16ch" h="0.75rem" />
            </div>
          ) : user.email ? (
            <div className="mt-1 break-words text-sm text-ink-3">
              {user.email}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-1 break-words text-sm text-ink-3">
              <Skeleton display="inline-block" w="10ch" h="0.75rem" />
            </div>
          ) : user.phone ? (
            <div className="mt-1 break-words text-sm text-ink-3">
              {user.phone}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <Skeleton w="4rem" h="1.375rem" pill />
          ) : (
            <Badge tone="info">{formatRole(user.role)}</Badge>
          )}

          {/* Real button, disabled. Fixed size and no data, so this is both
              more faithful than a grey rectangle and more honest about being
              inert. While loading there is no user_id to read, so the button
              renders on canInvite alone. */}
          {canInvite && (loading || user.user_id) ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => (isEditing ? onCancelEdit() : onBeginEdit(user))}
            >
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Reachable only through the Edit button, which is disabled while
          loading, so isEditing is always false then and this needs no
          loading state of its own. */}
      {isEditing && user.user_id ? (
        <div className="mt-3 grid items-end gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Full name</span>
            <input
              value={editFullName}
              onChange={(event) => setEditFullName(event.target.value)}
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
              placeholder="Full name"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Phone</span>
            <input
              value={editPhone}
              onChange={(event) => setEditPhone(event.target.value)}
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
              placeholder="Phone number"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Tenant role</span>
            <select
              value={editRole}
              onChange={(event) => setEditRole(event.target.value)}
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
              onClick={() => onSave(user.user_id!)}
            >
              {savingUser ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
