"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { countBillableVehicles } from "../../../lib/billing/vehicleCount";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { pricingHeadline } from "../../../lib/billing/pricingCopy";
import Badge from "../../../components/Badge";
import Button from "../../../components/Button";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";

type Company = {
    id: string;
    name: string;
    created_at?: string;
};

type Tenant = {
    id: string;
    company_id?: string | null;
};

type Vehicle = {
    id: string;
    tenant_id?: string | null;
    registration?: string | null;
};

type VehicleLicence = {
    id: string;
    tenant_id?: string | null;
    vehicle_id: string;
    active: boolean | null;
};

type Invoice = {
    id: string;
    company_id: string;
    vehicle_count: number | null;
    amount: number | null;
    status: string | null;
    created_at?: string;
};

type CompanyBilling = {
    company_id: string;
    status: string | null;
    next_charge_on: string | null;
    card_last4: string | null;
    retry_count: number | null;
};

export default function SuperAdminBillingPage() {
    const supabase = createClient();

    const [companies, setCompanies] = useState<Company[]>([]);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [licences, setLicences] = useState<VehicleLicence[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [subscriptionRows, setSubscriptionRows] = useState<CompanyBilling[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadData() {
        setLoading(true);
        setMessage("");

        const [
            { data: companiesData, error: companiesError },
            { data: tenantsData, error: tenantsError },
            { data: vehiclesData, error: vehiclesError },
            { data: licencesData, error: licencesError },
            { data: invoicesData, error: invoicesError },
            { data: subscriptionRowsData, error: subscriptionRowsError },
        ] = await Promise.all([
            supabase.from("companies").select("*").order("name"),
            supabase.from("tenants").select("id, company_id"),
            // vehicles has no company_id column; selecting one fails the whole
            // page with Postgres 42703. Ownership comes from tenant_id.
            supabase.from("vehicles").select("id, tenant_id, registration"),
            supabase.from("vehicle_licences").select("id, tenant_id, vehicle_id, active"),
            supabase.from("invoices").select("*").order("created_at", { ascending: false }),
            supabase
                .from("company_billing")
                .select("company_id, status, next_charge_on, card_last4, retry_count"),
        ]);

        if (
            companiesError ||
            tenantsError ||
            vehiclesError ||
            licencesError ||
            invoicesError ||
            subscriptionRowsError
        ) {
            setMessage(
                companiesError?.message ||
                tenantsError?.message ||
                vehiclesError?.message ||
                licencesError?.message ||
                invoicesError?.message ||
                subscriptionRowsError?.message ||
                "Unable to load billing data."
            );
        }

        setCompanies((companiesData as Company[]) || []);
        setTenants((tenantsData as Tenant[]) || []);
        setVehicles((vehiclesData as Vehicle[]) || []);
        setLicences((licencesData as VehicleLicence[]) || []);
        setInvoices((invoicesData as Invoice[]) || []);
        setSubscriptionRows((subscriptionRowsData as CompanyBilling[]) || []);
        setLoading(false);
    }

    useEffect(() => {
        loadData();
    }, []);

    const billingRows = useMemo(() => {
        return companies.map((company) => {
            const companyTenantIds = tenants
                .filter((tenant) => tenant.company_id === company.id)
                .map((tenant) => tenant.id);
            const tenantIdSet = new Set(companyTenantIds);

            const companyVehicles = vehicles.filter(
                (vehicle) =>
                    (vehicle.tenant_id != null && tenantIdSet.has(vehicle.tenant_id)) ||
                    vehicle.tenant_id === company.id
            );

            const billableVehicleCount = countBillableVehicles({
                companyId: company.id,
                companyTenantIds,
                vehicles,
                licences,
            });
            // Whole pounds net. netPence is always a multiple of 400 under the
            // tier table, so this never introduces a fraction, and invoices.amount
            // stays the pounds figure it has always been.
            const cycleChargePounds =
                computeChargeAmounts(billableVehicleCount).netPence / 100;

            const latestInvoice = invoices.find(
                (invoice) => invoice.company_id === company.id
            );

            return {
                company,
                totalVehicles: companyVehicles.length,
                billableVehicleCount,
                cycleChargePounds,
                latestInvoice,
            };
        });
    }, [companies, tenants, vehicles, licences, invoices]);

    async function createInvoice(companyId: string, vehicleCount: number, amount: number) {
        setMessage("");

        const { error } = await supabase.from("invoices").insert([
            {
                company_id: companyId,
                vehicle_count: vehicleCount,
                amount,
                status: "pending",
            },
        ]);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage("Invoice created.");
        await loadData();
    }

    return (
        /* Matches /super-admin/requests. The photo background and dark scrim
           that used to live here are gone on purpose: the console has one
           surface language and this area was the only thing outside it. */
        <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
            <div className="mx-auto w-full max-w-6xl">
                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Platform</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                        Super Admin Billing
                    </h1>

                    {/* Both models are live, so naming one is wrong for the
                        other half of the platform. The figures below this
                        header are still v1-shaped (they read platform_charges,
                        which v2 never writes); a v2 view of this console is
                        deliberately out of scope, see the 2026-09-11 spec. */}
                    <p className="m-0 text-sm text-ink-3">
                        Period billing (current): {pricingHeadline().summary}{" "}
                        Legacy 4-weekly billing: £10 per licensed vehicle per
                        week, less per vehicle on larger fleets. The figures
                        below cover 4-weekly companies only.
                    </p>
                </header>

                <MessageBanner tone="neutral">{message}</MessageBanner>

                {loading ? (
                    <div aria-busy className="grid gap-3">
                        <span className="sr-only" role="status">
                            Loading billing
                        </span>

                        {[0, 1, 2].map((index) => (
                            <div
                                key={`billing-skeleton-${index}`}
                                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                            >
                                <Skeleton w="16ch" h="1rem" />

                                <div className="mt-2 grid gap-1">
                                    <Skeleton w="18ch" h="0.75rem" />
                                    <Skeleton w="22ch" h="0.75rem" />
                                    <Skeleton w="20ch" h="0.75rem" />
                                    <Skeleton w="26ch" h="0.75rem" />
                                </div>

                                <div className="mt-3">
                                    <Skeleton w="7.5rem" h="2rem" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : billingRows.length === 0 ? (
                    <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                        No companies found.
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {billingRows.map((row) => {
                            const sub = subscriptionRows.find(
                                (s) => s.company_id === row.company.id
                            );
                            const isPastDue = sub?.status === "past_due";

                            return (
                                <div
                                    key={row.company.id}
                                    className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <h2 className="m-0 text-md font-semibold text-ink">
                                            {row.company.name}
                                        </h2>

                                        {/* past_due was the one thing this page coloured by
                                            hand (a raw #b91c1c plus bold). A danger Badge is
                                            the token-driven way to keep that emphasis. */}
                                        {sub ? (
                                            <Badge tone={isPastDue ? "danger" : "neutral"}>
                                                {sub.status ?? "unknown"}
                                            </Badge>
                                        ) : (
                                            <Badge tone="warning">no card on file</Badge>
                                        )}
                                    </div>

                                    <div className="mt-2 grid gap-0.5 text-sm text-ink-3">
                                        <div>
                                            Total Vehicles:{" "}
                                            <span className="text-ink-2">{row.totalVehicles}</span>
                                        </div>

                                        <div>
                                            Billable Licensed Vehicles:{" "}
                                            <span className="text-ink-2">
                                                {row.billableVehicleCount}
                                            </span>
                                        </div>

                                        <div>
                                            4-Weekly Charge:{" "}
                                            <span className="text-ink-2">
                                                {formatPence(row.cycleChargePounds * 100)} (ex VAT)
                                            </span>
                                        </div>

                                        {sub ? (
                                            <div
                                                className={
                                                    isPastDue ? "text-danger-strong" : undefined
                                                }
                                            >
                                                Subscription: {sub.status}
                                                {sub.card_last4
                                                    ? ` • card ****${sub.card_last4}`
                                                    : ""}
                                                {sub.next_charge_on
                                                    ? ` • next charge ${sub.next_charge_on}`
                                                    : ""}
                                                {isPastDue
                                                    ? ` • ${sub.retry_count ?? 0} failed attempts`
                                                    : ""}
                                            </div>
                                        ) : null}

                                        <div>
                                            Latest Invoice:{" "}
                                            <span className="text-ink-2">
                                                {row.latestInvoice
                                                    ? `£${row.latestInvoice.amount} • ${row.latestInvoice.status}`
                                                    : "None"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="mt-3">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() =>
                                                createInvoice(
                                                    row.company.id,
                                                    row.billableVehicleCount,
                                                    row.cycleChargePounds
                                                )
                                            }
                                        >
                                            Create Invoice
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
