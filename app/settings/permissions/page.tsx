"use client";

import Link from "next/link";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";

/*
  Per-page permissions are switched off (review SET-10, SET-20).

  The previous page could not work as written: user_permissions is deny-all
  for the authenticated role (docs/sql/rls_06_lock_secrets.sql), so every
  "grant" failed; profiles.email may not exist; unticking never revoked; and
  nothing anywhere reads user_permissions, so a tick changed nobody's access.
  Showing those controls gave admins a false sense of access control.

  Access today is decided by role (admin, staff, driver) on /settings/users.
  Bringing this page back needs a product decision on what a page permission
  should restrict, a server route to grant and revoke, and enforcement in
  RLS or the proxy.
*/
export default function PermissionsPage() {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Permissions
            </h1>
          </header>

          <MessageBanner tone="info">
            Per-page permissions are not available yet. What each person can
            do is set by their role (admin, staff or driver), which you can
            change on the{" "}
            <Link href="/settings/users" className="underline">
              Users
            </Link>{" "}
            page.
          </MessageBanner>
        </main>
      </div>
    </TenantGate>
  );
}
