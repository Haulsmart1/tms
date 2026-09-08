"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";

type Profile = {
  id: string;
  email: string | null;
};

const PAGES = [
  "dashboard",
  "jobs",
  "pod",
  "invoices",
  "customers",
  "subcontractors",
  "vehicles",
  "drivers",
  "tracking",
  "assets",
  "tachograph",
  "telematics",
  "maintenance",
];

export default function PermissionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const loadUsers = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoading(true);
    setErrorMessage("");

    /* profiles is in rls_03's excluded set, so it carries its own policy rather
       than the generated one. It still has a tenant_id column, which is what
       filterByTenant scopes on, so the admin tenant selector works here too. */
    const { data, error } = await tenant
      .filterByTenant(supabase.from("profiles").select("id, email"))
      .order("email", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      setUsers([]);
    } else {
      setUsers((data as Profile[]) ?? []);
      setDataTenantId(tenant.activeTenantId);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  async function grant(userId: string, page: string) {
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase.from("user_permissions").upsert({
      user_id: userId,
      page,
    });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(`Granted access to ${page}.`);
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Permissions
            </h1>

            {/* Stated rather than implied: these boxes are uncontrolled and
                write-only, so they do not show existing grants and unticking
                one does not revoke. That gap is the page's [PARTIAL] status in
                README, and is a feature to build, not a style to fix. */}
            <p className="m-0 text-sm text-ink-3">
              Ticking a page grants access. Existing grants are not shown yet, and unticking
              does not revoke.
            </p>
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

          {showSkeleton ? (
            <div aria-busy>
              <span className="sr-only" role="status">
                Loading users
              </span>

              {[0, 1, 2].map((index) => (
                <article
                  key={`user-skeleton-${index}`}
                  className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
                >
                  <h3 className="mb-2 text-md font-semibold text-ink">
                    <Skeleton display="inline-block" w="18ch" h="1rem" />
                  </h3>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PAGES.map((page) => (
                      <span key={page} className="flex items-center gap-2 text-sm text-ink-2">
                        <Skeleton w="0.875rem" h="0.875rem" />
                        <Skeleton display="inline-block" w="7ch" h="0.75rem" />
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
              No users found for this tenant.
            </div>
          ) : (
            users.map((user) => (
              <article
                key={user.id}
                className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <h3 className="mb-2 text-md font-semibold text-ink">{user.email}</h3>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {PAGES.map((page) => (
                    <label key={page} className="flex items-center gap-2 text-sm text-ink-2">
                      <input type="checkbox" onChange={() => grant(user.id, page)} />

                      {page}
                    </label>
                  ))}
                </div>
              </article>
            ))
          )}
        </main>
      </div>
    </TenantGate>
  );
}
