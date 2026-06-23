"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

const PRICE_PER_LICENSED_VEHICLE = 10;

type Company = {
    id: string;
    name: string;
    created_at?: string;
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

export default function SuperAdminBillingPage() {
    const supabase = createClient();

    const [companies, setCompanies] = useState<Company[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [licences, setLicences] = useState<VehicleLicence[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    async function loadData() {
        setLoading(true);
        setMessage("");

        const [
            { data: companiesData, error: companiesError },
            { data: vehiclesData, error: vehiclesError },
            { data: licencesData, error: licencesError },
            { data: invoicesData, error: invoicesError },
        ] = await Promise.all([
            supabase.from("companies").select("*").order("name"),
            supabase.from("vehicles").select("id, tenant_id, company_id, registration"),
            supabase.from("vehicle_licences").select("id, tenant_id, vehicle_id, active"),
            supabase.from("invoices").select("*").order("created_at", { ascending: false }),
        ]);

        if (companiesError || vehiclesError || licencesError || invoicesError) {
            setMessage(
                companiesError?.message ||
                vehiclesError?.message ||
                licencesError?.message ||
                invoicesError?.message ||
                "Unable to load billing data."
            );
        }

        setCompanies((companiesData as Company[]) || []);
        setVehicles((vehiclesData as Vehicle[]) || []);
        setLicences((licencesData as VehicleLicence[]) || []);
        setInvoices((invoicesData as Invoice[]) || []);
        setLoading(false);
    }

    useEffect(() => {
        loadData();
    }, []);

    const billingRows = useMemo(() => {
        return companies.map((company) => {
            const companyVehicles = vehicles.filter(
                (vehicle) =>
                    vehicle.tenant_id === company.id || vehicle.company_id === company.id
            );

            const vehicleIds = new Set(companyVehicles.map((vehicle) => vehicle.id));

            const licensedVehicleIds = new Set(
                licences
                    .filter(
                        (licence) => licence.active && vehicleIds.has(licence.vehicle_id)
                    )
                    .map((licence) => licence.vehicle_id)
            );

            const billableVehicleCount = licensedVehicleIds.size;
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
    }, [companies, vehicles, licences, invoices]);

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
