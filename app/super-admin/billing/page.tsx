"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { countBillableVehicles } from "../../../lib/billing/vehicleCount";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { pricingHeadline } from "../../../lib/billing/pricingCopy";
import Badge from "../../../components/Badge";
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

type CompanyBilling = {
    company_id: string;
    status: string | null;
    billing_model?: string;
    unit_amount_pence?: number;
    min_invoice_pence?: number;
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
            { data: subscriptionRowsData, error: subscriptionRowsError },
        ] = await Promise.all([
            supabase.from("companies").select("*").order("name"),
            supabase.from("tenants").select("id, company_id"),
            // vehicles has no company_id column; selecting one fails the whole
            // page with Postgres 42703. Ownership comes from tenant_id.
            supabase.from("vehicles").select("id, tenant_id, registration"),
            supabase.from("billable_vehicle_licences").select("id, tenant_id, vehicle_id, active"),
            supabase
                .from("company_billing")
                .select("company_id, status, next_charge_on, card_last4, retry_count, billing_model, unit_amount_pence, min_invoice_pence"),
        ]);

        if (
            companiesError ||
            tenantsError ||
            vehiclesError ||
            licencesError ||
            subscriptionRowsError
        ) {
            setMessage(
                companiesError?.message ||
                tenantsError?.message ||
                vehiclesError?.message ||
                licencesError?.message ||
                subscriptionRowsError?.message ||
                "Unable to load billing data."
            );
        }

        setCompanies((companiesData as Company[]) || []);
        setTenants((tenantsData as Tenant[]) || []);
        setVehicles((vehiclesData as Vehicle[]) || []);
        setLicences((licencesData as VehicleLicence[]) || []);
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
            return {
                company,
                totalVehicles: companyVehicles.length,
                billableVehicleCount,
            };
        });
    }, [companies, tenants, vehicles, licences]);

    /* READ-ONLY on purpose (AUTH-16, BILL1-8). This page used to have a
       "Create Invoice" button that inserted a row into `invoices` straight
       from the browser, priced with v1's computeChargeAmounts for every
       company, v2 included. `invoices` is the CUSTOMER invoicing ledger that
       Xero sync, credit notes and chase letters read, so a platform charge
       landing there at the wrong price could be synced or chased as if it
       were a haulier's own invoice, and a double click made two. Platform
       charges are raised by the billing cron (v1 platform_charges, v2
       billing_periods), not by hand here. Do not reintroduce a client write. */

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

                    <p className="m-0 text-sm text-ink-3">
                        Period billing: {pricingHeadline().summary}
                    </p>
                    <Link href="/super-admin/invoices" className="text-sm text-primary underline">
                        View subscription invoices and Square payments
                    </Link>
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

                                        {sub?.billing_model === "v2_period" ? (
                                            <div>
                                                Period rates (ex VAT): {formatPence(sub.unit_amount_pence ?? 0)} per vehicle · {formatPence(sub.min_invoice_pence ?? 0)} minimum
                                            </div>
                                        ) : sub ? (
                                            <div>
                                                4-week estimate: {formatPence(computeChargeAmounts(row.billableVehicleCount).netPence)} (ex VAT)
                                            </div>
                                        ) : null}

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
                                                {sub.billing_model !== "v2_period" && sub.next_charge_on
                                                    ? ` • next charge ${sub.billing_model !== "v2_period" && sub.next_charge_on}`
                                                    : ""}
                                                {isPastDue
                                                    ? ` • ${sub.retry_count ?? 0} failed attempts`
                                                    : ""}
                                            </div>
                                        ) : null}
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
