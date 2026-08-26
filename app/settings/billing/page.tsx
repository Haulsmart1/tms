"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import Stat from "../../../components/Stat";
import SquareCardForm from "../../../components/billing/SquareCardForm";
import { computeChargeAmounts } from "../../../lib/billing/money";

type BillingRow = {
  company_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
};

type ChargeRow = {
  id: string;
  cycle_date: string;
  attempt: number;
  vehicle_count: number;
  gross_pence: number;
  status: "succeeded" | "failed";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function BillingSettingsPage() {
  const supabase = createClient();
  const { role } = useTenant();

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [billingRes, chargesRes, licencesRes] = await Promise.all([
      supabase.from("company_billing").select("*").maybeSingle(),
      supabase
        .from("platform_charges")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(24),
      supabase.from("vehicle_licences").select("vehicle_id").eq("active", true),
    ]);
    const error = billingRes.error ?? chargesRes.error ?? licencesRes.error;
    if (error) {
      setLoadError(error.message);
    } else {
      setLoadError("");
    }
    setBilling((billingRes.data as BillingRow) ?? null);
    setCharges((chargesRes.data as ChargeRow[]) ?? []);
    setVehicleCount(new Set(licencesRes.data?.map((l) => l.vehicle_id)).size);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const amounts = computeChargeAmounts(vehicleCount);

  // super_admin's RLS scope returns every company's rows on this page (not
  // just their own), so maybeSingle() errors and the counts here would be
  // platform-wide, not this admin's. Platform billing across all companies
  // lives in the super-admin console instead.
  if (role === "super_admin") {
    return (
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <p className="text-sm text-ink-3">
            Platform billing for all companies lives in the super-admin
            console.{" "}
            <Link href="/super-admin/billing" className="text-primary underline">
              Go to super-admin billing
            </Link>
          </p>
        </main>
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <p className="text-sm text-ink-3">
            Billing is managed by your company admin.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-[1480px] px-6 py-8">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Admin</div>
          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Subscription
          </h1>
          <p className="text-sm text-ink-3">
            £10 per active licensed vehicle per month, plus VAT, charged to
            your card on your billing date.
          </p>
        </header>

        {loadError ? (
          <div className="mb-4 rounded-md border border-danger px-4 py-3 text-sm text-danger">
            Could not load billing data: {loadError}
          </div>
        ) : null}

        {billing?.status === "past_due" ? (
          <div className="mb-4 rounded-md border border-danger px-4 py-3 text-sm text-danger">
            Your last payment failed. Add a new card below to bring your
            subscription back up to date.
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4 rounded-md border border-line px-4 py-3 text-sm text-ink">
            {notice}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Licensed vehicles"
            value={String(vehicleCount)}
            sub="counted on each billing date"
          />
          <Stat
            label="Monthly total"
            value={pounds(amounts.grossPence)}
            sub={`${pounds(amounts.netPence)} + ${pounds(amounts.vatPence)} VAT`}
          />
          <Stat
            label="Status"
            value={billing ? billing.status.replace("_", " ") : "not set up"}
          />
          <Stat
            label="Next charge"
            value={billing?.next_charge_on ?? "n/a"}
          />
        </div>

        <section className="mb-6 max-w-[480px]">
          <h2 className="mb-2 text-base font-semibold text-ink">
            Payment method
          </h2>
          {billing && !showCardForm ? (
            <div className="flex items-center gap-3 rounded-md border border-line px-4 py-3 text-sm">
              <span>
                {billing.card_brand ?? "Card"} ending {billing.card_last4},
                expires {billing.card_exp_month}/{billing.card_exp_year}
              </span>
              <button
                type="button"
                onClick={() => setShowCardForm(true)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink"
                disabled={!!loadError}
              >
                Replace card
              </button>
            </div>
          ) : loadError ? (
            <p className="text-sm text-ink-3">
              Card management is unavailable until billing data loads
              successfully.
            </p>
          ) : (
            <SquareCardForm
              onComplete={(response) => {
                setShowCardForm(false);
                setNotice(
                  response.firstCharge
                    ? `Subscription started: ${pounds(Number(response.grossPence))} charged. Next charge ${response.nextChargeOn}.`
                    : "Card updated."
                );
                load();
              }}
            />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            Charge history
          </h2>
          {loading ? (
            <p className="text-sm text-ink-3">Loading...</p>
          ) : charges.length === 0 ? (
            <p className="text-sm text-ink-3">No charges yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="px-3 py-2 font-medium">Billing date</th>
                    <th className="px-3 py-2 font-medium">Attempt</th>
                    <th className="px-3 py-2 font-medium">Vehicles</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id} className="border-b border-line">
                      <td className="px-3 py-2">{charge.cycle_date}</td>
                      <td className="px-3 py-2">{charge.attempt}</td>
                      <td className="px-3 py-2">{charge.vehicle_count}</td>
                      <td className="px-3 py-2">{pounds(charge.gross_pence)}</td>
                      <td className="px-3 py-2">
                        {charge.status === "succeeded"
                          ? "Paid"
                          : `Failed (${charge.failure_code ?? "declined"})`}
                      </td>
                      <td className="px-3 py-2">
                        {charge.receipt_url ? (
                          <a
                            href={charge.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            View
                          </a>
                        ) : (
                          "n/a"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
