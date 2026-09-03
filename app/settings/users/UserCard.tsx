import Button from "../../../components/Button";
import Badge from "../../../components/Badge";
import Skeleton from "../../../components/Skeleton";
import type { TenantUser } from "./types";

type UserEdit = {
  fullName: string;
  setFullName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  role: string;
  setRole: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
};

type Props = {
  user: TenantUser;
  loading?: boolean;
  canInvite: boolean;
  /** null means not editing. Replaces a separate isEditing flag, which could
   *  disagree with these values. The edit form lives inside the card because
   *  it is part of the card's layout, but every value in it stays owned by
   *  the page. */
  edit: UserEdit | null;
  onBeginEdit: (user: TenantUser) => void;
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
  edit,
  onBeginEdit,
}: Props) {
  const isEditing = edit !== null;
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
              onClick={() => (edit ? edit.onCancel() : onBeginEdit(user))}
            >
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Reachable only through the Edit button, which is disabled while
          loading, so `edit` is always null then and this needs no
          loading state of its own. */}
      {edit && user.user_id ? (
        <div className="mt-3 grid items-end gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Full name</span>
            <input
              value={edit.fullName}
              onChange={(event) => edit.setFullName(event.target.value)}
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
              placeholder="Full name"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Phone</span>
            <input
              value={edit.phone}
              onChange={(event) => edit.setPhone(event.target.value)}
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
              placeholder="Phone number"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Tenant role</span>
            <select
              value={edit.role}
              onChange={(event) => edit.setRole(event.target.value)}
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
              disabled={edit.saving}
              onClick={edit.onSave}
            >
              {edit.saving ? "Saving..." : "Save Changes"}
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
