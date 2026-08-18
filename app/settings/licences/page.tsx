"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Card from "../../../components/Card";
import Button from "../../../components/Button";
import Stat from "../../../components/Stat";

const PRICE_PER_LICENSED_VEHICLE = 10;

type Vehicle = {
    id: string;
    tenant_id: string;
    registration: string | null;
    vehicle_type: string | null;
    make: string | null;
    model: string | null;
    active: boolean | null;
};

type VehicleLicence = {
    id: string;
    tenant_id: string;
    vehicle_id: string;
    licence_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    active: boolean | null;
    notes: string | null;
    created_at: string;
    vehicles?: Vehicle | null;
};

type VehicleLicenceRow = {
    id: string;
    tenant_id: string;
    vehicle_id: string;
    licence_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    active: boolean | null;
    notes: string | null;
    created_at: string;
    vehicles?: Vehicle[] | null;
};

export default function VehicleLicencesPage() {
    const supabase = createClient();
    const tenant = useTenant();

    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [licences, setLicences] = useState<VehicleLicence[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    const [vehicleId, setVehicleId] = useState("");
    const [licenceType, setLicenceType] = useState("");
    const [issueDate, setIssueDate] = useState("");
    const [expiryDate, setExpiryDate] = useState("");
    const [active, setActive] = useState(true);
    const [notes, setNotes] = useState("");

    async function loadData() {
        setLoading(true);
        setMessage("");

        const [
            { data: vehicleData, error: vehicleError },
            { data: licenceData, error: licenceError },
        ] = await Promise.all([
            tenant
                .filterByTenant(
                    supabase
                        .from("vehicles")
                        .select("id, tenant_id, registration, vehicle_type, make, model, active")
                )
                .order("registration", { ascending: true }),
            tenant
                .filterByTenant(
                    supabase
                        .from("vehicle_licences")
                        .select(`
          id,
          tenant_id,
          vehicle_id,
          licence_type,
          issue_date,
          expiry_date,
          active,
          notes,
          created_at,
          vehicles (
            id,
            tenant_id,
            registration,
            vehicle_type,
            make,
            model,
            active
          )
        `)
                )
                .order("created_at", { ascending: false }),
        ]);

        if (vehicleError) {
            setMessage(vehicleError.message);
        }

        if (licenceError) {
            setMessage(licenceError.message);
        }

        const normalizedLicences: VehicleLicence[] = (licenceData ?? []).map(
            (licence: VehicleLicenceRow) => ({
                ...licence,
                vehicles: licence.vehicles?.[0] ?? null,
            })
        );

        setVehicles(vehicleData ?? []);
        setLicences(normalizedLicences);
        setLoading(false);
    }

    useEffect(() => {
        loadData();
    }, [tenant.activeTenantId]);

    function resetForm() {
        setVehicleId("");
        setLicenceType("");
        setIssueDate("");
        setExpiryDate("");
        setActive(true);
        setNotes("");
    }

    async function createLicence(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setMessage("");

        if (!vehicleId) {
            setMessage("Please select a vehicle.");
            return;
        }

        if (!licenceType.trim()) {
            setMessage("Please enter a licence type.");
            return;
        }

        if (!tenant.writeTenantId) {
            setMessage("Pick a specific tenant to create records.");
            return;
        }

        setSaving(true);

        const { error } = await supabase.from("vehicle_licences").insert([
            {
                tenant_id: tenant.writeTenantId,
                vehicle_id: vehicleId,
                licence_type: licenceType.trim(),
                issue_date: issueDate || null,
                expiry_date: expiryDate || null,
                active,
                notes: notes.trim() || null,
            },
        ]);

        if (error) {
            setMessage(error.message);
            setSaving(false);
            return;
        }

        resetForm();
        setMessage("Licence added.");
        setSaving(false);
        await loadData();
    }

    async function deleteLicence(id: string) {
        if (!window.confirm("Delete licence?")) return;

        const { error } = await supabase
            .from("vehicle_licences")
            .delete()
            .eq("id", id);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage("Licence deleted.");
        await loadData();
    }

    async function toggleLicence(id: string, currentActive: boolean | null) {
        const { error } = await supabase
            .from("vehicle_licences")
            .update({ active: !currentActive })
            .eq("id", id);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage(!currentActive ? "Licence activated." : "Licence deactivated.");
        await loadData();
    }

    function vehicleLabel(vehicle: Vehicle) {
        const parts = [
            vehicle.registration || "No registration",
            vehicle.vehicle_type || null,
            [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null,
            vehicle.active === false ? "Inactive" : "Active",
        ].filter(Boolean);

        return parts.join(" • ");
    }

    const billableVehicleCount = useMemo(() => {
        const uniqueVehicleIds = new Set(
            licences
                .filter((licence) => licence.active)
                .map((licence) => licence.vehicle_id)
        );

        return uniqueVehicleIds.size;
    }, [licences]);

    const monthlyTotal = billableVehicleCount * PRICE_PER_LICENSED_VEHICLE;

    return (
        <TenantGate>
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
            <header className="mb-4">
                <div className="text-kicker uppercase text-ink-3">Admin</div>
                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Vehicle Licences</h1>
                <p className="m-0 text-sm text-ink-3">
                    Add and manage vehicle licences. Billing is £10 per licensed vehicle per month.
                </p>
            </header>

            <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Stat label="Licensed Vehicles" value={String(billableVehicleCount)} />
                <Stat label="Monthly Charge" value={`£${monthlyTotal}`} />
                <Stat label="Billing Rule" value="£10" sub="per licensed vehicle" />
            </div>

            <form
                onSubmit={createLicence}
                className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3"
            >
                <select
                    value={vehicleId}
                    onChange={(event) => setVehicleId(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                    required
                >
                    <option value="">Select vehicle</option>
                    {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                            {vehicleLabel(vehicle)}
                        </option>
                    ))}
                </select>

                <input
                    type="text"
                    placeholder="Licence type"
                    value={licenceType}
                    onChange={(event) => setLicenceType(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                    required
                />

                <input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <input
                    type="date"
                    value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <input
                    type="text"
                    placeholder="Notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <label className="flex min-h-10 items-center gap-2 rounded-md border border-ink-3 bg-surface px-3 text-sm text-ink-2">
                    <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) => setActive(event.target.checked)}
                    />
                    Active for billing
                </label>

                <div className="sm:col-span-2 lg:col-span-3">
                    <Button type="submit" disabled={saving}>
                        {saving ? "Saving..." : "Add Licence"}
                    </Button>
                </div>
            </form>

            <MessageBanner tone="neutral">{message}</MessageBanner>

            {loading ? (
                <Card>Loading...</Card>
            ) : (
                <div className="grid gap-3">
                    {licences.map((licence) => (
                        <article key={licence.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                            <h3 className="m-0 mb-2 text-md font-semibold text-ink">{licence.licence_type}</h3>

                            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                <div className="text-sm">
                                    <span className="text-kicker uppercase text-ink-3">Vehicle</span>{" "}
                                    <strong className="block text-ink">
                                        {licence.vehicles?.registration ||
                                            [licence.vehicles?.make, licence.vehicles?.model].filter(Boolean).join(" ") ||
                                            licence.vehicle_id}
                                    </strong>
                                </div>

                                <div className="text-sm">
                                    <span className="text-kicker uppercase text-ink-3">Issue Date</span>{" "}
                                    <strong className="block font-mono text-ink">{licence.issue_date || "-"}</strong>
                                </div>

                                <div className="text-sm">
                                    <span className="text-kicker uppercase text-ink-3">Expiry Date</span>{" "}
                                    <strong className="block font-mono text-ink">{licence.expiry_date || "-"}</strong>
                                </div>

                                <div className="text-sm">
                                    <span className="text-kicker uppercase text-ink-3">Billing Status</span>{" "}
                                    <strong className="block text-ink">{licence.active ? "Active" : "Inactive"}</strong>
                                </div>

                                <div className="text-sm">
                                    <span className="text-kicker uppercase text-ink-3">Notes</span>{" "}
                                    <strong className="block text-ink">{licence.notes || "-"}</strong>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="secondary"
                                    onClick={() => toggleLicence(licence.id, licence.active)}
                                >
                                    {licence.active ? "Deactivate" : "Activate"}
                                </Button>

                                <Button
                                    variant="danger"
                                    onClick={() => deleteLicence(licence.id)}
                                >
                                    Delete
                                </Button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </main>
        </div>
        </TenantGate>
    );
}
