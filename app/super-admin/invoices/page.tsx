"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import Badge, { type Tone } from "../../../components/Badge";
import Button from "../../../components/Button";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";

type Invoice = {
  id: string;
  company_id: string | null;
  vehicle_count: number | null;
  amount: number | null;
  status: string | null;
};

function statusTone(status: string | null): Tone {
  switch ((status ?? "").toLowerCase()) {
    case "paid":
      return "success";
    case "overdue":
      return "danger";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

export default function SuperAdminInvoicesPage() {
  const supabase = createClient();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadInvoices() {
    setLoading(true);

    const { data, error } = await supabase
      .from("invoices")
      .select("id, company_id, vehicle_count, amount, status")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
    }

    setInvoices((data as Invoice[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadInvoices();
  }, []);

  async function markStatus(id: string, status: string) {
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase.from("invoices").update({ status }).eq("id", id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(`Invoice marked ${status}.`);
    await loadInvoices();
  }

  return (
    /* Matches /super-admin/requests. The photo background and dark scrim that
       used to live here are gone on purpose: the console has one surface
       language and this area was the only thing outside it. */
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Invoices
          </h1>

          <p className="m-0 text-sm text-ink-3">
            Platform invoices across every company.
          </p>
        </header>

        <MessageBanner tone="danger">{errorMessage}</MessageBanner>

        <MessageBanner tone="success">{message}</MessageBanner>

        {loading ? (
          <div aria-busy className="grid gap-3">
            <span className="sr-only" role="status">
              Loading invoices
            </span>

            {[0, 1, 2, 3].map((index) => (
              <div
                key={`invoice-skeleton-${index}`}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <Skeleton w="14ch" h="1rem" />
                  <Skeleton w="4.5rem" h="1.375rem" pill />
                </div>

                <div className="mt-2 grid gap-1">
                  <Skeleton w="22ch" h="0.75rem" />
                  <Skeleton w="10ch" h="0.75rem" />
                  <Skeleton w="12ch" h="0.75rem" />
                </div>

                <div className="mt-3 flex gap-2">
                  <Skeleton w="6.5rem" h="2rem" />
                  <Skeleton w="7.5rem" h="2rem" />
                </div>
              </div>
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
            No invoices found.
          </div>
        ) : (
          <div className="grid gap-3">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="m-0 text-md font-semibold text-ink">
                    Invoice #{invoice.id.slice(0, 8)}
                  </h3>

                  <Badge tone={statusTone(invoice.status)}>{invoice.status ?? "unknown"}</Badge>
                </div>

                <div className="mt-2 grid gap-0.5 text-sm text-ink-3">
                  <div>
                    Company ID:{" "}
                    <span className="font-mono text-ink-2">{invoice.company_id ?? "-"}</span>
                  </div>

                  <div>
                    Vehicles: <span className="text-ink-2">{invoice.vehicle_count ?? "-"}</span>
                  </div>

                  <div>
                    Amount: <span className="text-ink-2">£{invoice.amount ?? "-"}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => markStatus(invoice.id, "paid")}
                  >
                    Mark Paid
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => markStatus(invoice.id, "pending")}
                  >
                    Mark Pending
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
