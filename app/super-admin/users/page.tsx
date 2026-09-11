"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { filterBySearch } from "../../../lib/superAdmin/search";
import type { SuperAdminUserRow } from "../../../lib/superAdmin/users";
import { SUPER_ADMIN_ROLE } from "../../../lib/roles";
import DataTable, { type Column, type DataTableState } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import SearchInput from "../../../components/SearchInput";

/* Row type comes from lib/superAdmin/users.ts (buildUserRows), which is what
   /api/super-admin/users actually returns, rather than being redeclared here:
   that module dropped createdAt, which nothing in this page ever rendered, so
   a local copy would carry a field that is always undefined. */

/* Single source for the Role column's text, used by both the cell and the
   search field below so they cannot say different things. hasProfile is the
   discriminator, not a null check: an invited-but-never-edited user has
   fullName and role both null too (see SuperAdminUserRow's comment), so
   testing those fields here would relabel most legitimate users as
   incomplete. */
function roleLabel(row: SuperAdminUserRow): string {
  if (!row.hasProfile) return "incomplete";
  if (row.role === SUPER_ADMIN_ROLE) return "super admin";
  return row.role || "none";
}

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<SuperAdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  /* Server route rather than a client query: email lives in auth.users, which
     no RLS policy exposes to the browser, and without it a user whose
     full_name is null is identified on screen only by a UUID. */
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/super-admin/users");
      const payload = (await response.json()) as { users?: SuperAdminUserRow[]; error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Unable to load users.");
        setUsers([]);
      } else {
        setUsers(payload.users ?? []);
      }
    } catch {
      setMessage("Could not reach the server.");
      setUsers([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      filterBySearch(query, users, (row) => [
        // The strings each cell actually renders, not the raw nullable
        // fields: an operator who sees "incomplete", "none" or "Unnamed
        // user" on screen must be able to type that word and find it.
        row.fullName || row.email || "Unnamed user",
        row.email || "No email on file",
        roleLabel(row),
        row.companyName || "none",
        row.tenantName || "none",
        row.id,
      ]),
    [query, users],
  );

  const columns: Column<SuperAdminUserRow>[] = [
    {
      header: "User",
      cell: (row) => (
        <div>
          <div className="font-medium text-ink">{row.fullName || row.email || "Unnamed user"}</div>
          <div className="text-xs text-ink-3">{row.email || "No email on file"}</div>
        </div>
      ),
    },
    {
      header: "Role",
      cell: (row) => {
        const label = roleLabel(row);

        /* !hasProfile is exactly the auth.users-row-with-no-profiles-row
           case (lib/superAdmin/users.ts): a half-completed invite, because
           app/api/settings/users/invite/route.ts creates the auth user
           first and only then does separate, non-transactional inserts into
           users/profiles/memberships with no rollback if one of those
           throws. These are the accounts an operator most needs to notice,
           so mark them rather than let them read as a blank role. */
        if (!row.hasProfile) return <Badge tone="warning">{label}</Badge>;

        return row.role === SUPER_ADMIN_ROLE ? (
          <Badge tone="info">{label}</Badge>
        ) : (
          <span className="text-ink-2">{label}</span>
        );
      },
    },
    { header: "Company", cell: (row) => row.companyName || <span className="text-ink-3">none</span> },
    { header: "Tenant", cell: (row) => row.tenantName || <span className="text-ink-3">none</span> },
    {
      header: "User ID",
      cell: (row) => <span className="font-mono text-xs text-ink-3">{row.id}</span>,
    },
  ];

  const state: DataTableState = loading
    ? "loading"
    : message
      ? "error"
      : visible.length === 0
        ? "empty"
        : "ready";

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">All Users</h1>

          <p className="m-0 text-sm text-ink-3">
            Every account across every tenant, including ones with no profile row yet.
          </p>
        </header>

        {/* Skeletons are aria-hidden by design, so without this a screen
            reader gets silence for the whole load. */}
        <span className="sr-only" role="status">
          {loading ? "Loading users" : ""}
        </span>

        <SearchInput
          id="user-search"
          label="Search users"
          value={query}
          onChange={setQuery}
          placeholder="Search by name, email, company, role"
          resultHint={!loading && query ? `${visible.length} of ${users.length} users` : undefined}
        />

        {/* No separate danger banner for a load failure: the table's own
            error state below carries the same message plus a Retry button,
            and showing both would say it twice. */}
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          state={state}
          errorMessage={message}
          onRetry={load}
          emptyTitle={query ? `Nothing matches "${query}"` : "No users yet"}
          emptyDescription={query ? "Clear the search to see every user." : undefined}
        />
      </div>
    </div>
  );
}
