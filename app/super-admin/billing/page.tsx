"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { countBillableVehicles } from "../../../lib/billing/vehicleCount";

const PRICE_PER_LICENSED_VEHICLE = 10;

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
    company_id?: string | null;
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
            supabase.from("vehicles").select("id, tenant_id, company_id, registration"),
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
                    vehicle.tenant_id === company.id ||
                    vehicle.company_id === company.id
            );

            const billableVehicleCount = countBillableVehicles({
                companyId: company.id,
                companyTenantIds,
                vehicles,
                licences,
            });
            const monthlyCharge = billableVehicleCount * PRICE_PER_LICENSED_VEHICLE;

            const latestInvoice = invoices.find(
                (invoice) => invoice.company_id === company.id
            );

            return {
                company,
                totalVehicles: companyVehicles.length,
                billableVehicleCount,
                monthlyCharge,
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
        <main
            style={{
                minHeight: "100vh",
                padding: 30,
                backgroundImage:
                    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
                backgroundSize: "cover",
                backgroundPosition: "center",
            }}
        >
            <div
                style={{
                    background: "rgba(0,0,0,0.65)",
                    padding: 30,
                    borderRadius: 20,
                }}
            >
                <div style={{ color: "white", marginBottom: 24 }}>
                    <h1 style={{ marginTop: 0, fontSize: 38 }}>Super Admin Billing</h1>
                    <p style={{ opacity: 0.85, marginBottom: 0 }}>
                        Billing is charged at £10 per licensed vehicle per month.
                    </p>
                </div>

                {message ? (
                    <div
                        style={{
                            background: "white",
                            padding: 12,
                            borderRadius: 10,
                            marginBottom: 20,
                        }}
                    >
                        {message}
                    </div>
                ) : null}

                {loading ? (
                    <div
                        style={{
                            background: "white",
                            padding: 20,
                            borderRadius: 14,
                        }}
                    >
                        Loading...
                    </div>
                ) : null}

                <div style={{ display: "grid", gap: 16 }}>
                    {billingRows.map((row) => (
                        <div
                            key={row.company.id}
                            style={{
                                background: "rgba(255,255,255,0.95)",
                                padding: 20,
                                borderRadius: 14,
                                boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
                            }}
                        >
                            <h2 style={{ marginTop: 0, marginBottom: 8 }}>{row.company.name}</h2>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Total Vehicles: {row.totalVehicles}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Billable Licensed Vehicles: {row.billableVehicleCount}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                Monthly Charge: £{row.monthlyCharge}
                            </div>

                            {(() => {
                                const sub = subscriptionRows.find(
                                    (s) => s.company_id === row.company.id
                                );
                                if (!sub) {
                                    return (
                                        <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                            Subscription: no card on file
                                        </div>
                                    );
                                }
                                const isPastDue = sub.status === "past_due";
                                return (
                                    <div
                                        style={{
                                            marginBottom: 12,
                                            color: isPastDue ? "#b91c1c" : undefined,
                                            fontWeight: isPastDue ? 700 : undefined,
                                            opacity: isPastDue ? 1 : 0.8,
                                        }}
                                    >
                                        Subscription: {sub.status}
                                        {sub.card_last4 ? ` • card ****${sub.card_last4}` : ""}
                                        {sub.next_charge_on
                                            ? ` • next charge ${sub.next_charge_on}`
                                            : ""}
                                        {isPastDue
                                            ? ` • ${sub.retry_count ?? 0} failed attempts`
                                            : ""}
                                    </div>
                                );
                            })()}

                            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                Latest Invoice:{" "}
                                {row.latestInvoice
                                    ? `£${row.latestInvoice.amount} • ${row.latestInvoice.status}`
                                    : "None"}
                            </div>

                            <button
                                type="button"
                                onClick={() =>
                                    createInvoice(
                                        row.company.id,
                                        row.billableVehicleCount,
                                        row.monthlyCharge
                                    )
                                }
                                style={{
                                    padding: "10px 14px",
                                    borderRadius: 10,
                                    border: "none",
                                    background: "#111827",
                                    color: "white",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                }}
                            >
                                Create Invoice
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
