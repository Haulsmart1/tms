import { isSquareSandboxReceipt } from "../../../lib/payments/squareReceipt";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { formatCycleDate, formatPence } from "../../../lib/billing/format";
import MessageBanner from "../../../components/MessageBanner";
import { resolveSuperAdmin, superAdminDenial } from "../../../lib/superAdmin/guard";

const HISTORY_LIMIT = 100;
const CHARGE_COLUMNS = "id, company_id, gross_pence, currency, status, square_payment_id, receipt_url, created_at";

type SquareCharge = {
  id: string;
  company_id: string;
  gross_pence: number;
  currency: string;
  status: string;
  square_payment_id: string | null;
  receipt_url: string | null;
  created_at: string;
};

function amount(pence: number, currency: string) {
  return currency === "GBP" ? formatPence(pence) : `${(pence / 100).toFixed(2)} ${currency}`;
}

function paymentStatus(charge: SquareCharge) {
  if (isSquareSandboxReceipt(charge.receipt_url)) return "Square test payment";
  if (charge.status === "succeeded") {
    return charge.square_payment_id ? "Paid via Square" : "No Square payment reference";
  }
  if (charge.status === "refunded") return "Refunded";
  return charge.status;
}

export default async function SuperAdminInvoicesPage() {
  const { userId, roleName } = await resolveSuperAdmin();
  const denial = superAdminDenial(userId, roleName);
  if (denial?.status === 401) redirect("/login?next=%2Fsuper-admin%2Finvoices");
  if (denial) redirect("/dashboard");

  const supabase = await createClient();
  const [companies, periods, cycles, additions] = await Promise.all([
    supabase.from("companies").select("id, name"),
    supabase.from("billing_periods")
      .select("id, company_id, period_start, period_end, gross_pence, status, period_charges(gross_pence, status, square_payment_id, receipt_url)")
      .not("gross_pence", "is", null)
      .order("period_end", { ascending: false }).order("id").limit(HISTORY_LIMIT),
    supabase.from("platform_charges").select(CHARGE_COLUMNS).gt("gross_pence", 0)
      .order("created_at", { ascending: false }).order("id").limit(HISTORY_LIMIT),
    supabase.from("vehicle_addon_charges").select(CHARGE_COLUMNS).gt("gross_pence", 0)
      .order("created_at", { ascending: false }).order("id").limit(HISTORY_LIMIT),
  ]);
  const companyNames = new Map(companies.data?.map((row) => [row.id, row.name]));
  const legacyCharges = [
    ...(cycles.data ?? []).map((row) => ({ ...row, type: "Four-week cycle" })),
    ...(additions.data ?? []).map((row) => ({ ...row, type: "Vehicle addition" })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, HISTORY_LIMIT);

  return (
    <main className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-ink">Platform invoices</h1>
          <p className="text-sm text-ink-3">TMS subscription invoices and Square payments across companies.</p>
        </header>
        {companies.error ? <MessageBanner tone="warning">Company names could not be loaded.</MessageBanner> : null}
        <section aria-labelledby="period-invoices">
          <h2 id="period-invoices" className="text-md font-semibold">Subscription periods</h2>
          {periods.error ? <MessageBanner tone="danger">Could not load subscription invoices.</MessageBanner> : null}
          {!periods.error && !periods.data?.length ? <p className="text-sm text-ink-3">No subscription invoices yet.</p> : null}
          <ul className="grid list-none gap-3 p-0">
            {periods.data?.map((period) => {
              const hasTestPayment = period.period_charges.some((charge) => isSquareSandboxReceipt(charge.receipt_url));
              const squarePaid = period.period_charges
                .filter((charge) => charge.status === "succeeded" && charge.square_payment_id && !isSquareSandboxReceipt(charge.receipt_url))
                .reduce((sum, charge) => sum + Number(charge.gross_pence), 0);
              return (
                <li key={period.id} className="rounded-lg border border-line bg-surface p-4">
                  <strong>{companyNames.get(period.company_id) ?? period.company_id}</strong>
                  <p className="text-sm text-ink-3">
                    {formatCycleDate(period.period_start)} to {formatCycleDate(period.period_end)}
                  </p>
                  <p className="text-sm">{formatPence(period.gross_pence)} incl. VAT · {hasTestPayment ? "Includes Square test payment" : period.status}</p>
                  <p className="text-sm">Collected via Square: {formatPence(squarePaid)}</p>
                </li>
              );
            })}
          </ul>
          {periods.data?.length === HISTORY_LIMIT ? <p className="text-sm">Showing the latest {HISTORY_LIMIT} invoices.</p> : null}
        </section>
        <section aria-labelledby="legacy-charges">
          <h2 id="legacy-charges" className="text-md font-semibold">Legacy subscription charges</h2>
          {cycles.error || additions.error ? <MessageBanner tone="danger">Some legacy charges could not be loaded.</MessageBanner> : null}
          {!cycles.error && !additions.error && !legacyCharges.length ? <p className="text-sm text-ink-3">No legacy charges.</p> : null}
          <ul className="grid list-none gap-3 p-0">
            {legacyCharges.map((charge) => (
              <li key={`${charge.type}-${charge.id}`} className="rounded-lg border border-line bg-surface p-4">
                <strong>{companyNames.get(charge.company_id) ?? charge.company_id}</strong>
                <p className="text-sm text-ink-3">{charge.type} · {formatCycleDate(charge.created_at.slice(0, 10))}</p>
                <p className="text-sm">{amount(charge.gross_pence, charge.currency)} incl. VAT · {paymentStatus(charge)}</p>
              </li>
            ))}
          </ul>
          {legacyCharges.length === HISTORY_LIMIT ? <p className="text-sm">Showing the latest {HISTORY_LIMIT} charges.</p> : null}
        </section>
      </div>
    </main>
  );
}
