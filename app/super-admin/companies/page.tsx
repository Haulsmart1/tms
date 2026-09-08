"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";

type Company = {
  id: string;
  name: string | null;
};

export default function SuperAdminCompaniesPage() {
  const supabase = createClient();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadCompanies() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("companies")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      setMessage(error.message);
      setCompanies([]);
    } else {
      setCompanies((data as Company[]) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  return (
    /* Matches /super-admin/requests, the first page in this area to move onto
       the design system. The photo background and dark scrim that used to live
       here are gone on purpose: the console has one surface language and this
       area was the only thing outside it. */
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Companies
          </h1>

          <p className="m-0 text-sm text-ink-3">
            Every company on the platform.
          </p>
        </header>

        <MessageBanner tone="danger">{message}</MessageBanner>

        {loading ? (
          <div aria-busy className="grid gap-3">
            <span className="sr-only" role="status">
              Loading companies
            </span>

            {[0, 1, 2, 3].map((index) => (
              <div
                key={`company-skeleton-${index}`}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <Skeleton w="14ch" h="1rem" />
                <div className="mt-2">
                  <Skeleton w="24ch" h="0.75rem" />
                </div>
              </div>
            ))}
          </div>
        ) : companies.length === 0 ? (
          <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
            No companies found.
          </div>
        ) : (
          <div className="grid gap-3">
            {companies.map((company) => (
              <div
                key={company.id}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <h3 className="m-0 text-md font-semibold text-ink">{company.name}</h3>

                <div className="mt-1 font-mono text-xs text-ink-3">ID: {company.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
