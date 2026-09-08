"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";

type ProfileRow = {
    id: string;
    tenant_id: string | null;
    full_name: string | null;
    created_at: string | null;
    roles?: { name: string }[] | null;
};

type UserRow = {
    id: string;
    tenant_id: string | null;
    full_name: string | null;
    created_at: string | null;
    role: string | null;
};

export default function SuperAdminUsersPage() {
    const supabase = createClient();

    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadUsers() {
        setLoading(true);
        setMessage("");

        const { data, error } = await supabase
            .from("profiles")
            .select(`
        id,
        tenant_id,
        full_name,
        created_at,
        roles (
          name
        )
      `)
            .order("created_at", { ascending: false });

        if (error) {
            setMessage(error.message);
            setUsers([]);
            setLoading(false);
            return;
        }

        const normalizedUsers: UserRow[] = (data ?? []).map((user: ProfileRow) => ({
            id: user.id,
            tenant_id: user.tenant_id,
            full_name: user.full_name,
            created_at: user.created_at,
            role: user.roles?.[0]?.name ?? null,
        }));

        setUsers(normalizedUsers);
        setLoading(false);
    }

    useEffect(() => {
        loadUsers();
    }, []);

    return (
        /* Matches /super-admin/requests. The photo background and dark scrim
           that used to live here are gone on purpose: the console has one
           surface language and this area was the only thing outside it. */
        <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
            <div className="mx-auto w-full max-w-6xl">
                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Platform</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                        All Users
                    </h1>

                    <p className="m-0 text-sm text-ink-3">
                        Every user profile across every tenant.
                    </p>
                </header>

                <MessageBanner tone="danger">{message}</MessageBanner>

                {loading ? (
                    <div aria-busy className="grid gap-3">
                        <span className="sr-only" role="status">
                            Loading users
                        </span>

                        {[0, 1, 2, 3].map((index) => (
                            <div
                                key={`user-skeleton-${index}`}
                                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                            >
                                <Skeleton w="12ch" h="1rem" />

                                <div className="mt-2 grid gap-1">
                                    <Skeleton w="20ch" h="0.75rem" />
                                    <Skeleton w="10ch" h="0.75rem" />
                                    <Skeleton w="24ch" h="0.75rem" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : users.length === 0 ? (
                    <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                        No users found.
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {users.map((user) => (
                            <div
                                key={user.id}
                                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                            >
                                <h3 className="m-0 text-md font-semibold text-ink">
                                    {user.full_name || user.id}
                                </h3>

                                <div className="mt-2 grid gap-0.5 text-sm text-ink-3">
                                    <div>
                                        Tenant:{" "}
                                        <span className="font-mono text-ink-2">
                                            {user.tenant_id || "-"}
                                        </span>
                                    </div>

                                    <div>
                                        Role:{" "}
                                        <span className="text-ink-2">{user.role || "-"}</span>
                                    </div>

                                    <div>
                                        User ID:{" "}
                                        <span className="font-mono text-ink-2">{user.id}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
