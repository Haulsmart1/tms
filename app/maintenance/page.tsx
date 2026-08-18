"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import Badge, { type Tone } from "../../components/Badge";
import Button from "../../components/Button";
import Field from "../../components/Field";
import Textarea from "../../components/Textarea";

type Vehicle = {
    id: string;
    tenant_id: string;
    registration: string | null;
    vehicle_type: string | null;
    make: string | null;
    model: string | null;
    active: boolean | null;
    vor: boolean | null;
    vor_since: string | null;
    vor_reason: string | null;
    returned_to_service_at: string | null;
};

type Asset = {
    id: string;
    tenant_id: string;
    name: string;
    asset_type: string;
    asset_number: string | null;
    registration: string | null;
    barcode: string | null;
    mechanical: boolean;
    status: string | null;
};

type MaintenanceRecord = {
    id: string;
    vehicle_id: string | null;
    asset_id: string | null;
    maintenance_type: string;
    due_date: string | null;
    completed_date: string | null;
    status: string;
    cost: number | null;
    mileage: number | null;
    maintenance_hours: number | null;
    notes: string | null;
    created_at: string;
};

type MaintenanceRecordWithVehicle = MaintenanceRecord & {
    vehicle: Vehicle | null;
    asset: Asset | null;
};

export default function MaintenancePage() {
    const supabase = useMemo(() => createClient(), []);

    const [tenantId, setTenantId] = useState<string | null>(null);

    const [vehicles, setVehicles] = useState<Vehicle[]>([]);

    const [assets, setAssets] = useState<Asset[]>([]);
    const [records, setRecords] = useState<MaintenanceRecordWithVehicle[]>([]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [vorSaving, setVorSaving] = useState(false);

    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const [vehicleId, setVehicleId] = useState("");

    const [assetId, setAssetId] = useState("");
    const [maintenanceType, setMaintenanceType] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [completedDate, setCompletedDate] = useState("");
    const [status, setStatus] = useState("due");
    const [cost, setCost] = useState("");
    const [mileage, setMileage] = useState("");
    const [maintenanceHours, setMaintenanceHours] = useState("");
    const [notes, setNotes] = useState("");

    const [vorReason, setVorReason] = useState("");

    const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
    const [editMaintenanceType, setEditMaintenanceType] = useState("");
    const [editStatus, setEditStatus] = useState("due");
    const [editDueDate, setEditDueDate] = useState("");
    const [editCompletedDate, setEditCompletedDate] = useState("");
    const [editCost, setEditCost] = useState("");
    const [editMileage, setEditMileage] = useState("");
    const [editMaintenanceHours, setEditMaintenanceHours] = useState("");
    const [editNotes, setEditNotes] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const selectedVehicle =
        vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;

    const vorVehicles = vehicles.filter(
        (vehicle) => vehicle.vor === true || vehicle.active === false
    );

    const resolveTenantId = useCallback(async (): Promise<string | null> => {
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
            throw userError;
        }

        if (!user) {
            window.location.href = "/";
            return null;
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("id", user.id)
            .single();

        if (profileError) {
            throw profileError;
        }

        if (!profile?.tenant_id) {
            throw new Error(
                "Your account is not linked to a TMS Wizzard tenant."
            );
        }

        return profile.tenant_id as string;
    }, [supabase]);

    const loadData = useCallback(
        async (currentTenantId: string) => {
            setLoading(true);
            setErrorMessage("");

            try {
                /*
                 * We deliberately DO NOT embed vehicles inside
                 * maintenance_records here.
                 *
                 * Your database previously had two relationships between
                 * maintenance_records.vehicle_id and vehicles.id, which caused:
                 *
                 * "Could not embed because more than one relationship was found"
                 *
                 * Fetching them independently also keeps this page resilient.
                 */

                const [
                    vehicleResult,
                    maintenanceResult,
                ] = await Promise.all([
                    supabase
                        .from("vehicles")
                        .select(
                            `
                            id,
                            tenant_id,
                            registration,
                            vehicle_type,
                            make,
                            model,
                            active,
                            vor,
                            vor_since,
                            vor_reason,
                            returned_to_service_at
                            `
                        )
                        .eq("tenant_id", currentTenantId)
                        .order("registration", {
                            ascending: true,
                        }),

                    supabase
                        .from("maintenance_records")
                        .select(
                            `
                            id,
                            vehicle_id,
                            asset_id,
                            maintenance_type,
                            due_date,
                            completed_date,
                            status,
                            cost,
                            mileage,
                            maintenance_hours,
                            notes,
                            created_at
                            `
                        )
                        .order("created_at", {
                            ascending: false,
                        }),
                ]);

                if (vehicleResult.error) {
                    throw vehicleResult.error;
                }

                if (maintenanceResult.error) {
                    throw maintenanceResult.error;
                }

                const tenantVehicles =
                    (vehicleResult.data ?? []) as Vehicle[];
                const {
                    data: assetData,
                    error: assetError,
                } = await supabase
                    .from("assets")
                    .select(
                        "id, tenant_id, name, asset_type, asset_number, registration, barcode, mechanical, status"
                    )
                    .eq("tenant_id", currentTenantId)
                    .eq("mechanical", true)
                    .order("asset_number", {
                        ascending: true,
                    });

                if (assetError) {
                    throw assetError;
                }

                const tenantAssets =
                    (assetData ?? []) as Asset[];

                const assetMap = new Map(
                    tenantAssets.map((asset) => [
                        asset.id,
                        asset,
                    ])
                );

                const vehicleMap = new Map(
                    tenantVehicles.map((vehicle) => [
                        vehicle.id,
                        vehicle,
                    ])
                );

                const tenantMaintenance =
                    (maintenanceResult.data ?? [])
                        .map(
                            (
                                record
                            ): MaintenanceRecordWithVehicle => ({
                                ...(record as MaintenanceRecord),
                                vehicle:
                                    record.vehicle_id
                                        ? vehicleMap.get(
                                              record.vehicle_id
                                          ) ?? null
                                        : null,
                                asset:
                                    record.asset_id
                                        ? assetMap.get(
                                              record.asset_id
                                          ) ?? null
                                        : null,
                            })
                        )
                        .filter(
                            (record) =>
                                record.vehicle !== null ||
                                record.asset !== null
                        );

                setVehicles(tenantVehicles);
                setAssets(tenantAssets);
                setRecords(tenantMaintenance);
            } catch (error) {
                setErrorMessage(
                    error instanceof Error
                        ? error.message
                        : "Unable to load maintenance information."
                );
            } finally {
                setLoading(false);
            }
        },
        [supabase]
    );

    useEffect(() => {
        async function initialise() {
            try {
                const resolvedTenantId =
                    await resolveTenantId();

                if (!resolvedTenantId) {
                    return;
                }

                setTenantId(resolvedTenantId);

                await loadData(resolvedTenantId);
            } catch (error) {
                setErrorMessage(
                    error instanceof Error
                        ? error.message
                        : "Unable to initialise maintenance."
                );

                setLoading(false);
            }
        }

        void initialise();
    }, [resolveTenantId, loadData]);

    function resetForm() {
        setVehicleId("");
        setAssetId("");
        setMaintenanceType("");
        setDueDate("");
        setCompletedDate("");
        setStatus("due");
        setCost("");
        setMileage("");
        setMaintenanceHours("");
        setNotes("");
        setVorReason("");
    }

    function clearMessages() {
        setMessage("");
        setErrorMessage("");
    }

    async function createRecord(
        event: FormEvent<HTMLFormElement>
    ) {
        event.preventDefault();

        clearMessages();

        if (!tenantId) {
            setErrorMessage("Tenant not loaded.");
            return;
        }
        if (!vehicleId && !assetId) {
            setErrorMessage(
                "Select a vehicle or mechanical asset."
            );
            return;
        }

        if (!maintenanceType.trim()) {
            setErrorMessage(
                "Please enter a maintenance type."
            );
            return;
        }

        const numericMileage =
            mileage.trim() === ""
                ? null
                : Number(mileage);

        const numericMaintenanceHours =
            maintenanceHours.trim() === ""
                ? null
                : Number(maintenanceHours);

        if (
            numericMileage !== null &&
            (!Number.isFinite(numericMileage) || numericMileage < 0)
        ) {
            setErrorMessage("Enter a valid mileage.");
            return;
        }

        if (
            numericMaintenanceHours !== null &&
            (!Number.isFinite(numericMaintenanceHours) ||
                numericMaintenanceHours < 0)
        ) {
            setErrorMessage("Enter valid maintenance hours.");
            return;
        }
        setSaving(true);

        try {
            const payload = {
                vehicle_id: vehicleId || null,
                asset_id: assetId || null,
                tenant_id: tenantId,
                maintenance_type:
                    maintenanceType.trim(),
                due_date: dueDate || null,
                completed_date:
                    completedDate || null,
                status,
                cost:
                    cost.trim() !== ""
                        ? Number(cost)
                        : null,
                mileage: numericMileage,
                maintenance_hours: numericMaintenanceHours,
                notes: notes.trim() || null,
            };

            const { error } = await supabase
                .from("maintenance_records")
                .insert(payload);

            if (error) {
                throw error;
            }

            /*
             * If a maintenance record itself is marked VOR,
             * also mark the vehicle VOR.
             */

            if (status === "vor" && vehicleId) {
                const reason =
                    vorReason.trim() ||
                    notes.trim() ||
                    maintenanceType.trim();

                const { error: vehicleError } =
                    await supabase
                        .from("vehicles")
                        .update({
                            vor: true,
                            active: false,
                            vor_since:
                                new Date().toISOString(),
                            vor_reason: reason,
                        })
                        .eq("id", vehicleId)
                        .eq(
                            "tenant_id",
                            tenantId
                        );

                if (vehicleError) {
                    throw new Error(
                        `Maintenance record saved, but VOR update failed: ${vehicleError.message}`
                    );
                }
            }

            setMessage(
                status === "vor"
                    ? "Maintenance record saved and vehicle marked VOR."
                    : "Maintenance record added."
            );

            resetForm();

            await loadData(tenantId);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to save maintenance record."
            );
        } finally {
            setSaving(false);
        }
    }

    function beginEditRecord(record: MaintenanceRecordWithVehicle) {
        clearMessages();

        setEditingRecordId(record.id);
        setEditMaintenanceType(record.maintenance_type ?? "");
        setEditStatus(record.status ?? "due");
        setEditDueDate(record.due_date ?? "");
        setEditCompletedDate(record.completed_date ?? "");

        setEditCost(
            record.cost !== null && record.cost !== undefined
                ? String(record.cost)
                : ""
        );

        setEditMileage(
            record.mileage !== null && record.mileage !== undefined
                ? String(record.mileage)
                : ""
        );

        setEditMaintenanceHours(
            record.maintenance_hours !== null &&
                record.maintenance_hours !== undefined
                ? String(record.maintenance_hours)
                : ""
        );

        setEditNotes(record.notes ?? "");
    }

    function cancelEditRecord() {
        setEditingRecordId(null);
        setEditMaintenanceType("");
        setEditStatus("due");
        setEditDueDate("");
        setEditCompletedDate("");
        setEditCost("");
        setEditMileage("");
        setEditMaintenanceHours("");
        setEditNotes("");
    }

    async function saveEditRecord(recordId: string) {
        if (!tenantId) {
            setErrorMessage("Tenant not loaded.");
            return;
        }

        const trimmedType = editMaintenanceType.trim();

        if (!trimmedType) {
            setErrorMessage("Maintenance type is required.");
            return;
        }

        const numericCost =
            editCost.trim() === ""
                ? null
                : Number(editCost);

        const numericMileage =
            editMileage.trim() === ""
                ? null
                : Number(editMileage);

        const numericHours =
            editMaintenanceHours.trim() === ""
                ? null
                : Number(editMaintenanceHours);

        if (
            numericCost !== null &&
            (!Number.isFinite(numericCost) || numericCost < 0)
        ) {
            setErrorMessage("Cost must be a valid positive number.");
            return;
        }

        if (
            numericMileage !== null &&
            (!Number.isFinite(numericMileage) || numericMileage < 0)
        ) {
            setErrorMessage("Mileage must be a valid positive number.");
            return;
        }

        if (
            numericHours !== null &&
            (!Number.isFinite(numericHours) || numericHours < 0)
        ) {
            setErrorMessage(
                "Maintenance hours must be a valid positive number."
            );
            return;
        }

        clearMessages();
        setEditSaving(true);

        try {
            const { error } = await supabase
                .from("maintenance_records")
                .update({
                    maintenance_type: trimmedType,
                    status: editStatus,
                    due_date: editDueDate || null,
                    completed_date: editCompletedDate || null,
                    cost: numericCost,
                    mileage: numericMileage,
                    maintenance_hours: numericHours,
                    notes: editNotes.trim() || null,
                })
                .eq("id", recordId)
                .eq("tenant_id", tenantId);

            if (error) {
                throw error;
            }

            await loadData(tenantId);

            cancelEditRecord();
            setMessage("Maintenance record updated.");
        } catch (error) {
            console.error("Failed to update maintenance record:", error);

            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to update maintenance record."
            );
        } finally {
            setEditSaving(false);
        }
    }
    async function placeVehicleVor(
        vehicle: Vehicle
    ) {
        if (!tenantId) {
            return;
        }

        clearMessages();

        const reason = vorReason.trim();

        if (!reason) {
            setErrorMessage(
                "Please enter a VOR reason before taking the vehicle off the road."
            );
            return;
        }

        const confirmed = window.confirm(
            `Mark ${
                vehicle.registration ??
                "this vehicle"
            } as VOR?\n\nThe vehicle will be unavailable for operations.`
        );

        if (!confirmed) {
            return;
        }

        setVorSaving(true);

        try {
            const now = new Date().toISOString();

            const { error } = await supabase
                .from("vehicles")
                .update({
                    vor: true,
                    active: false,
                    vor_since: now,
                    vor_reason: reason,
                })
                .eq("id", vehicle.id)
                .eq("tenant_id", tenantId);

            if (error) {
                throw error;
            }

            setMessage(
                `${vehicle.registration ?? "Vehicle"} is now VOR.`
            );

            setVorReason("");

            await loadData(tenantId);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to mark vehicle VOR."
            );
        } finally {
            setVorSaving(false);
        }
    }

    async function returnVehicleToService(
        vehicle: Vehicle
    ) {
        if (!tenantId) {
            return;
        }

        clearMessages();

        const confirmed = window.confirm(
            `Return ${
                vehicle.registration ??
                "this vehicle"
            } to service?`
        );

        if (!confirmed) {
            return;
        }

        setVorSaving(true);

        try {
            const now = new Date().toISOString();

            const { error } = await supabase
                .from("vehicles")
                .update({
                    vor: false,
                    active: true,
                    vor_since: null,
                    vor_reason: null,
                    returned_to_service_at: now,
                })
                .eq("id", vehicle.id)
                .eq("tenant_id", tenantId);

            if (error) {
                throw error;
            }

            setMessage(
                `${vehicle.registration ?? "Vehicle"} returned to service.`
            );

            await loadData(tenantId);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to return vehicle to service."
            );
        } finally {
            setVorSaving(false);
        }
    }

    function vehicleLabel(vehicle: Vehicle) {
        const description = [
            vehicle.registration ||
                "No registration",
            vehicle.vehicle_type,
            [vehicle.make, vehicle.model]
                .filter(Boolean)
                .join(" ") || null,
            vehicle.vor ||
            vehicle.active === false
                ? "VOR"
                : "In Service",
        ].filter(Boolean);

        return description.join(" • ");
    }

    return (
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">
                <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-kicker uppercase text-ink-3">
                            Fleet Compliance
                        </div>

                        <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                            Maintenance Records
                        </h1>

                        <p className="mb-4 text-sm text-ink-3">
                            Manage maintenance,
                            defects and vehicle
                            off-road status.
                        </p>
                    </div>

                    <div className="flex gap-2.5">
                        <div className="min-w-[90px] rounded-lg border border-line bg-surface p-4 shadow-sm">
                            <span className="block text-xs font-medium uppercase text-ink-3">
                                Fleet
                            </span>

                            <strong className="mt-1 block font-mono text-2xl font-semibold tabular-nums text-ink">
                                {vehicles.length}
                            </strong>
                        </div>

                        <div className="min-w-[90px] rounded-lg border border-line bg-surface p-4 shadow-sm">
                            <span className="block text-xs font-medium uppercase text-ink-3">
                                VOR
                            </span>

                            <strong
                                className={`mt-1 block font-mono text-2xl font-semibold tabular-nums ${
                                    vorVehicles.length >
                                    0
                                        ? "text-danger-strong"
                                        : "text-success-strong"
                                }`}
                            >
                                {
                                    vorVehicles.length
                                }
                            </strong>
                        </div>
                    </div>
                </header>

                {errorMessage ? (
                    <div className="mb-4 rounded-lg border border-danger-border bg-danger-tint p-3 text-sm text-danger-strong">
                        {errorMessage}
                    </div>
                ) : null}

                {message ? (
                    <div className="mb-4 rounded-lg border border-success-border bg-success-tint p-3 text-sm text-success-strong">
                        {message}
                    </div>
                ) : null}

                {vorVehicles.length > 0 ? (
                    <section
                        aria-label="Vehicles off road"
                        className="mb-4 rounded-lg border border-warning-border bg-warning-tint p-4"
                    >
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="mb-2 text-md font-semibold text-warning-strong">
                                    Vehicles Off Road
                                </h2>

                                <p className="mb-3 text-sm text-ink-3">
                                    These vehicles
                                    should not be
                                    allocated to jobs.
                                </p>
                            </div>

                            <Badge tone="danger">
                                {
                                    vorVehicles.length
                                }{" "}
                                VOR
                            </Badge>
                        </div>

                        <div className="grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-3">
                            {vorVehicles.map(
                                (vehicle) => (
                                    <div
                                        key={
                                            vehicle.id
                                        }
                                        className="grid content-start gap-3 rounded-lg border border-danger-border bg-surface p-4"
                                    >
                                        <div className="min-w-0">
                                            <strong className="break-words text-md font-semibold text-ink">
                                                {vehicle.registration ??
                                                    "Vehicle"}
                                            </strong>

                                            <div className="mt-0.5 break-words text-sm text-ink-3">
                                                {[
                                                    vehicle.make,
                                                    vehicle.model,
                                                    vehicle.vehicle_type,
                                                ]
                                                    .filter(
                                                        Boolean
                                                    )
                                                    .join(
                                                        " • "
                                                    ) ||
                                                    "No description"}
                                            </div>
                                        </div>

                                        <div className="grid min-w-0 gap-1 rounded-md bg-danger-tint p-3">
                                            <span className="block text-kicker uppercase text-ink-3">
                                                VOR
                                                reason
                                            </span>

                                            <strong className="break-words text-sm font-semibold text-ink">
                                                {vehicle.vor_reason ||
                                                    "Not recorded"}
                                            </strong>

                                            {vehicle.vor_since ? (
                                                <span className="block text-xs text-ink-3">
                                                    Since{" "}
                                                    {formatDateTime(
                                                        vehicle.vor_since
                                                    )}
                                                </span>
                                            ) : null}
                                        </div>

                                        <Button
                                            disabled={
                                                vorSaving
                                            }
                                            onClick={() =>
                                                void returnVehicleToService(
                                                    vehicle
                                                )
                                            }
                                        >
                                            Return to
                                            Service
                                        </Button>
                                    </div>
                                )
                            )}
                        </div>
                    </section>
                ) : null}

                <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                    <div>
                        <h2 className="mb-1 text-md font-semibold text-ink">
                            Add Maintenance Record
                        </h2>

                        <p className="mb-3 text-sm text-ink-3">
                            Record inspections,
                            repairs, servicing or
                            defects.
                        </p>
                    </div>

                    <form
                        onSubmit={createRecord}
                        className="grid gap-3"
                    >
                        <label className="grid gap-1.5">
                            <span className="text-sm font-medium text-ink-2">
                                Maintenance Target
                            </span>

                            <select
                                value={
                                    assetId
                                        ? `asset:${assetId}`
                                        : vehicleId
                                          ? `vehicle:${vehicleId}`
                                          : ""
                                }
                                onChange={(event) => {
                                    const value =
                                        event.target.value;

                                    if (
                                        value.startsWith(
                                            "vehicle:"
                                        )
                                    ) {
                                        setVehicleId(
                                            value.slice(
                                                "vehicle:".length
                                            )
                                        );
                                        setAssetId("");
                                        return;
                                    }

                                    if (
                                        value.startsWith(
                                            "asset:"
                                        )
                                    ) {
                                        setAssetId(
                                            value.slice(
                                                "asset:".length
                                            )
                                        );
                                        setVehicleId("");
                                        return;
                                    }

                                    setVehicleId("");
                                    setAssetId("");
                                }}
                                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                                required
                            >
                                <option value="">
                                    Select vehicle or mechanical asset
                                </option>

                                {vehicles.length > 0 ? (
                                    <optgroup label="Vehicles">
                                        {vehicles.map(
                                            (vehicle) => (
                                                <option
                                                    key={vehicle.id}
                                                    value={`vehicle:${vehicle.id}`}
                                                >
                                                    {vehicleLabel(
                                                        vehicle
                                                    )}
                                                </option>
                                            )
                                        )}
                                    </optgroup>
                                ) : null}

                                {assets.length > 0 ? (
                                    <optgroup label="Mechanical Assets">
                                        {assets.map(
                                            (asset) => (
                                                <option
                                                    key={asset.id}
                                                    value={`asset:${asset.id}`}
                                                >
                                                    {[
                                                        asset.asset_number,
                                                        asset.name,
                                                        asset.asset_type,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" — ")}
                                                </option>
                                            )
                                        )}
                                    </optgroup>
                                ) : null}
                            </select>
                        </label>

                        {selectedVehicle ? (
                            <div
                                className={
                                    selectedVehicle.vor ||
                                    selectedVehicle.active ===
                                        false
                                        ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-tint p-4"
                                        : "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success-border bg-success-tint p-4"
                                }
                            >
                                <div className="min-w-0">
                                    <span className="block text-kicker uppercase text-ink-3">
                                        Vehicle
                                        Status
                                    </span>

                                    <strong className="mt-0.5 block break-words text-md font-semibold text-ink">
                                        {selectedVehicle.registration ??
                                            "Vehicle"}
                                    </strong>

                                    <span className="mt-0.5 block text-xs text-ink-3">
                                        {selectedVehicle.vor ||
                                        selectedVehicle.active ===
                                            false
                                            ? "Vehicle Off Road"
                                            : "Available for Service"}
                                    </span>
                                </div>

                                {selectedVehicle.vor ||
                                selectedVehicle.active ===
                                    false ? (
                                    <Button
                                        disabled={
                                            vorSaving
                                        }
                                        onClick={() =>
                                            void returnVehicleToService(
                                                selectedVehicle
                                            )
                                        }
                                    >
                                        Return to
                                        Service
                                    </Button>
                                ) : (
                                    <div className="flex grow basis-[400px] justify-end gap-2">
                                        <input
                                            type="text"
                                            value={
                                                vorReason
                                            }
                                            onChange={(
                                                event
                                            ) =>
                                                setVorReason(
                                                    event
                                                        .target
                                                        .value
                                                )
                                            }
                                            placeholder="Reason for VOR"
                                            aria-label="Reason for VOR"
                                            className="h-10 min-w-0 flex-1 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                                        />

                                        <Button
                                            variant="danger"
                                            disabled={
                                                vorSaving
                                            }
                                            onClick={() =>
                                                void placeVehicleVor(
                                                    selectedVehicle
                                                )
                                            }
                                        >
                                            VOR Vehicle
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                                id="maint-type"
                                label="Maintenance Type"
                                type="text"
                                placeholder="e.g. PMI, tyres, brakes, service"
                                value={
                                    maintenanceType
                                }
                                onChange={(
                                    event
                                ) =>
                                    setMaintenanceType(
                                        event.target
                                            .value
                                    )
                                }
                                required
                            />

                            <label className="grid gap-1.5">
                                <span className="text-sm font-medium text-ink-2">
                                    Status
                                </span>

                                <select
                                    value={status}
                                    onChange={(
                                        event
                                    ) =>
                                        setStatus(
                                            event.target
                                                .value
                                        )
                                    }
                                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                                >
                                    <option value="due">
                                        Due
                                    </option>

                                    <option value="scheduled">
                                        Scheduled
                                    </option>

                                    <option value="in_progress">
                                        In Progress
                                    </option>

                                    <option value="completed">
                                        Completed
                                    </option>

                                    <option value="overdue">
                                        Overdue
                                    </option>

                                    <option value="vor">
                                        VOR
                                    </option>
                                </select>
                            </label>

                            <Field
                                id="maint-due-date"
                                label="Due Date"
                                type="date"
                                value={dueDate}
                                onChange={(
                                    event
                                ) =>
                                    setDueDate(
                                        event.target
                                            .value
                                    )
                                }
                            />

                            <Field
                                id="maint-completed-date"
                                label="Completed Date"
                                type="date"
                                value={
                                    completedDate
                                }
                                onChange={(
                                    event
                                ) =>
                                    setCompletedDate(
                                        event.target
                                            .value
                                    )
                                }
                            />

                            <Field
                                id="maint-cost"
                                label="Cost"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={cost}
                                onChange={(
                                    event
                                ) =>
                                    setCost(
                                        event.target
                                            .value
                                    )
                                }
                            />
                        </div>

                        {status === "vor" &&
                        selectedVehicle &&
                        !selectedVehicle.vor ? (
                            <Field
                                id="maint-vor-reason"
                                label="VOR Reason"
                                type="text"
                                value={vorReason}
                                onChange={(
                                    event
                                ) =>
                                    setVorReason(
                                        event.target
                                            .value
                                    )
                                }
                                placeholder="Why is the vehicle off road?"
                            />
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field
                                id="maint-mileage"
                                label="Mileage at Maintenance"
                                type="number"
                                min="0"
                                step="1"
                                value={mileage}
                                onChange={(event) =>
                                    setMileage(event.target.value)
                                }
                                placeholder="e.g. 125000"
                            />

                            <Field
                                id="maint-hours"
                                label="Maintenance Hours"
                                type="number"
                                min="0"
                                step="0.25"
                                value={maintenanceHours}
                                onChange={(event) =>
                                    setMaintenanceHours(
                                        event.target.value
                                    )
                                }
                                placeholder="e.g. 3.5"
                            />
                        </div>

                        <Textarea
                            id="maint-notes"
                            label="Notes"
                            value={notes}
                            onChange={(event) =>
                                setNotes(
                                    event.target
                                        .value
                                )
                            }
                            placeholder="Maintenance notes..."
                            rows={4}
                            className="resize-y"
                        />

                        <Button
                            type="submit"
                            disabled={saving}
                        >
                            {saving
                                ? "Saving..."
                                : "Add Maintenance Record"}
                        </Button>
                    </form>
                </section>

                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                    <div>
                        <h2 className="mb-1 text-md font-semibold text-ink">
                            Maintenance History
                        </h2>

                        <p className="mb-3 text-sm text-ink-3">
                            {records.length} maintenance
                            record
                            {records.length === 1
                                ? ""
                                : "s"}
                        </p>
                    </div>

                    {loading ? (
                        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                            Loading maintenance
                            records...
                        </div>
                    ) : records.length === 0 ? (
                        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                            No maintenance records
                            found.
                        </div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
                            {records.map((record) => (
                                <article
                                    key={record.id}
                                    className="rounded-lg border border-line bg-surface-2 p-4"
                                >
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="break-words text-md font-semibold text-ink">
                                                {
                                                    record.maintenance_type
                                                }
                                            </h3>

                                            <p className="mt-1 break-words text-sm text-ink-3">
                                                {record.asset
                                                    ? [
                                                          record
                                                              .asset
                                                              .asset_number,
                                                          record
                                                              .asset
                                                              .name,
                                                          record
                                                              .asset
                                                              .asset_type,
                                                      ]
                                                          .filter(Boolean)
                                                          .join(" — ")
                                                    : record.vehicle
                                                          ?.registration ||
                                                      [
                                                          record
                                                              .vehicle
                                                              ?.make,
                                                          record
                                                              .vehicle
                                                              ?.model,
                                                      ]
                                                          .filter(Boolean)
                                                          .join(" ") ||
                                                      "Maintenance target"}
                                            </p>
                                        </div>

                                        <Badge
                                            tone={maintenanceStatusTone(
                                                record.status
                                            )}
                                        >
                                            {formatStatus(
                                                record.status
                                            )}
                                        </Badge>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2.5">
                                        <RecordItem
                                            label="Due"
                                            value={
                                                record.due_date ||
                                                "—"
                                            }
                                        />

                                        <RecordItem
                                            label="Completed"
                                            value={
                                                record.completed_date ||
                                                "—"
                                            }
                                        />

                                        <RecordItem
                                            label="Mileage"
                                            value={
                                                record.mileage !== null &&
                                                record.mileage !== undefined
                                                    ? `${Number(
                                                          record.mileage
                                                      ).toLocaleString()} miles`
                                                    : "—"
                                            }
                                        />

                                        <RecordItem
                                            label="Maintenance Hours"
                                            value={
                                                record.maintenance_hours !==
                                                    null &&
                                                record.maintenance_hours !==
                                                    undefined
                                                    ? `${record.maintenance_hours} hrs`
                                                    : "—"
                                            }
                                        />

                                        <RecordItem
                                            label="Cost"
                                            value={
                                                record.cost !==
                                                null
                                                    ? `£${Number(
                                                          record.cost
                                                      ).toFixed(
                                                          2
                                                      )}`
                                                    : "—"
                                            }
                                        />
                                    </div>

                                    {record.notes ? (
                                        <div className="mt-3 break-words rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-ink-2">
                                            {
                                                record.notes
                                            }
                                        </div>
                                    ) : null}

                                    {record.vehicle?.vor ? (
                                        <div className="mt-3 rounded-md bg-danger-tint p-2 text-center text-xs font-semibold text-danger-strong">
                                            Vehicle currently
                                            VOR
                                        </div>
                                    ) : null}

                                    <div className="mt-4 border-t border-line pt-3.5">
                                        {editingRecordId !== record.id ? (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() =>
                                                    beginEditRecord(record)
                                                }
                                            >
                                                Edit
                                            </Button>
                                        ) : (
                                            <div className="grid gap-3.5">
                                                <div className="font-semibold text-ink">
                                                    Edit Maintenance Record
                                                </div>

                                                <Field
                                                    id={`maint-${record.id}-type`}
                                                    label="Maintenance Type"
                                                    type="text"
                                                    value={
                                                        editMaintenanceType
                                                    }
                                                    onChange={(event) =>
                                                        setEditMaintenanceType(
                                                            event.target
                                                                .value
                                                        )
                                                    }
                                                />

                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <label className="grid gap-1.5">
                                                        <span className="text-sm font-medium text-ink-2">
                                                            Status
                                                        </span>
                                                        <select
                                                            value={editStatus}
                                                            onChange={(event) =>
                                                                setEditStatus(
                                                                    event.target
                                                                        .value
                                                                )
                                                            }
                                                            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                                                        >
                                                            <option value="due">
                                                                Due
                                                            </option>
                                                            <option value="completed">
                                                                Completed
                                                            </option>
                                                            <option value="vor">
                                                                VOR
                                                            </option>
                                                        </select>
                                                    </label>

                                                    <Field
                                                        id={`maint-${record.id}-cost`}
                                                        label="Cost (£)"
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={editCost}
                                                        onChange={(event) =>
                                                            setEditCost(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <Field
                                                        id={`maint-${record.id}-due-date`}
                                                        label="Due Date"
                                                        type="date"
                                                        value={editDueDate}
                                                        onChange={(event) =>
                                                            setEditDueDate(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />

                                                    <Field
                                                        id={`maint-${record.id}-completed-date`}
                                                        label="Completed Date"
                                                        type="date"
                                                        value={
                                                            editCompletedDate
                                                        }
                                                        onChange={(event) =>
                                                            setEditCompletedDate(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <Field
                                                        id={`maint-${record.id}-mileage`}
                                                        label="Mileage"
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={
                                                            editMileage
                                                        }
                                                        onChange={(event) =>
                                                            setEditMileage(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />

                                                    <Field
                                                        id={`maint-${record.id}-hours`}
                                                        label="Maintenance Hours"
                                                        type="number"
                                                        min="0"
                                                        step="0.1"
                                                        value={
                                                            editMaintenanceHours
                                                        }
                                                        onChange={(event) =>
                                                            setEditMaintenanceHours(
                                                                event.target
                                                                    .value
                                                            )
                                                        }
                                                    />
                                                </div>

                                                <Textarea
                                                    id={`maint-${record.id}-notes`}
                                                    label="Notes"
                                                    value={editNotes}
                                                    onChange={(event) =>
                                                        setEditNotes(
                                                            event.target
                                                                .value
                                                        )
                                                    }
                                                    rows={4}
                                                    className="resize-y"
                                                />

                                                <div className="flex flex-wrap gap-2.5">
                                                    <Button
                                                        disabled={editSaving}
                                                        onClick={() =>
                                                            void saveEditRecord(
                                                                record.id
                                                            )
                                                        }
                                                    >
                                                        {editSaving
                                                            ? "Saving..."
                                                            : "Save Changes"}
                                                    </Button>

                                                    <Button
                                                        variant="secondary"
                                                        disabled={editSaving}
                                                        onClick={
                                                            cancelEditRecord
                                                        }
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

function RecordItem({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="min-w-0">
            <span className="mb-0.5 block text-kicker uppercase text-ink-3">
                {label}
            </span>

            <strong className="block break-words text-sm font-semibold text-ink-2">
                {value}
            </strong>
        </div>
    );
}

function formatStatus(value: string) {
    return value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) =>
            character.toUpperCase()
        );
}

function formatDateTime(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function maintenanceStatusTone(
    status: string
): Tone {
    if (status === "completed") {
        return "success";
    }

    if (
        status === "vor" ||
        status === "overdue"
    ) {
        return "danger";
    }

    if (status === "in_progress") {
        return "info";
    }

    return "warning";
}
