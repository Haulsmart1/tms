"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Button from "../../../components/Button";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import LicenceCard from "./LicenceCard";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import type { LicenceVehicle, VehicleLicence } from "./types";

/* Three, because these cards are full width in a single-column grid and are
   taller than a vehicle card. A guess about data that has not arrived. */
const SKELETON_CARDS = 3;

/* One field, and the card is written so that no field is read while loading:
   the cell values it would evaluate eagerly are behind an explicit `loading`
   check in LicenceCard, and everything else is inside a `loading` branch. A
   fuller object would be a second copy of "which fields the card reads",
   drifting silently the first time the card reads one more. THE GUARANTEE
   LIVES IN THE CARD, NOT HERE: see the note above LicenceCard's Vehicle cell
   before adding a field that this object does not have. */
const PLACEHOLDER_LICENCE = { id: "skeleton" } as VehicleLicence;

/* The raw PostgREST shape, deliberately NOT in types.ts. PostgREST returns an
   embedded join as an array even for a to-one relationship, so this exists
   only to be normalised into VehicleLicence by loadData below. types.ts holds
   the normalised UI contract the card consumes; this is a query detail and
   nothing outside this file should ever see it. */
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
    vehicles?: LicenceVehicle[] | null;
};

export default function VehicleLicencesPage() {
    const supabase = createClient();
    const tenant = useTenant();

    const [vehicles, setVehicles] = useState<LicenceVehicle[]>([]);
    const [licences, setLicences] = useState<VehicleLicence[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

    const [vehicleId, setVehicleId] = useState("");
    const [licenceType, setLicenceType] = useState("");
    const [issueDate, setIssueDate] = useState("");
    const [expiryDate, setExpiryDate] = useState("");
    const [active, setActive] = useState(true);
    const [notes, setNotes] = useState("");

    async function loadData() {
        if (tenant.status !== "ready") return;

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
        if (!licenceError) {
            setDataTenantId(tenant.activeTenantId);
        }
        setLoading(false);
    }

    useEffect(() => {
        loadData();
    }, [tenant.status, tenant.activeTenantId]);

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

    function vehicleLabel(vehicle: LicenceVehicle) {
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

    const amounts = computeChargeAmounts(billableVehicleCount);

    /* ONE flag, because the two containers it drives - the Stat row and the
       card grid - both read `licences` and nothing else, which makes them one
       region separated by the add form. The vehicles list loaded alongside
       feeds only that form's <select>, whose options are not visible until it
       is opened, so it needs no flag of its own.

       Each container carries its own aria-busy; exactly ONE sr-only
       role="status" line travels with the flag, and it sits on the grid, which
       is the region the old "Loading..." card stood in for. Both rules are
       stated in full above shouldShowSkeleton in
       lib/loading/skeletonVisibility.ts. */
    const showSkeleton = shouldShowSkeleton({
        tenantStatus: tenant.status,
        fetching: loading,
        hasData: licences.length > 0,
        activeTenantId: tenant.activeTenantId,
        dataTenantId,
    });

    const showEmpty = !showSkeleton && licences.length === 0;

    return (
        <TenantGate>
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
            <header className="mb-4">
                <div className="text-kicker uppercase text-ink-3">Admin</div>
                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Vehicle Licences</h1>
                <p className="m-0 text-sm text-ink-3">
                    Add and manage vehicle licences. £10 per licensed vehicle
                    per week, less per vehicle on larger fleets, charged every 4
                    weeks.
                </p>
            </header>

            {/* These two tiles are derived from `licences`, so they are part of
                the same loading region as the grid below and must not state a
                count of zero as fact while the query is in flight. The third
                is the fixed price and is never a skeleton. */}
            <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-busy={showSkeleton}>
                <Stat
                    label="Licensed Vehicles"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
                        ) : (
                            String(billableVehicleCount)
                        )
                    }
                />
                <Stat
                    label="4-Weekly Charge"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="10ch" h="1.25rem" />
                        ) : (
                            formatPence(amounts.grossPence)
                        )
                    }
                    sub="this tenant only, inc VAT"
                />
                <Stat label="Billing Rule" value="£10" sub="per vehicle per week, less on larger fleets" />
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

            {showEmpty ? (
                <p className="py-10 text-center text-sm text-ink-3">
                    No licences found.
                </p>
            ) : null}

            {/* ONE grid container shared by the skeleton and the real cards, and
                not rendered at all when there is neither, matching /vehicles and
                /subcontractors. Two containers would let these classes drift
                apart and the layout jump on arrival. */}
            {showSkeleton || licences.length > 0 ? (
                <div className="grid gap-3" aria-busy={showSkeleton}>
                    {/* One announcement for the region, not one per bar. Replaces
                        what the old "Loading..." card gave free. */}
                    {showSkeleton ? (
                        <span className="sr-only" role="status">Loading licences</span>
                    ) : null}

                    {showSkeleton
                        ? Array.from({ length: SKELETON_CARDS }, (_, index) => (
                            <LicenceCard
                                key={`skeleton-${index}`}
                                licence={PLACEHOLDER_LICENCE}
                                loading
                                onToggle={() => {}}
                                onDelete={() => {}}
                            />
                        ))
                        : licences.map((licence) => (
                            <LicenceCard
                                key={licence.id}
                                licence={licence}
                                onToggle={(id, active) => void toggleLicence(id, active)}
                                onDelete={(id) => void deleteLicence(id)}
                            />
                        ))}
                </div>
            ) : null}
        </main>
        </div>
        </TenantGate>
    );
}
