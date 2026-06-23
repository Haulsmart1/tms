"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const FALLBACK_TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

type Vehicle = {
    id: string;
    tenant_id: string;
    registration: string | null;
    vehicle_type: string | null;
    make: string | null;
    model: string | null;
    active: boolean | null;
};

type MaintenanceRecord = {
    id: string;
    vehicle_id: string | null;
    maintenance_type: string;
    due_date: string | null;
    completed_date: string | null;
    status: string;
    cost: number | null;
    notes: string | null;
    created_at: string;
    vehicles?: Vehicle | null;
};

type MaintenanceRecordRow = {
    id: string;
    vehicle_id: string | null;
    maintenance_type: string;
    due_date: string | null;
    completed_date: string | null;
    status: string;
    cost: number | null;
    notes: string | null;
    created_at: string;
    vehicles?: Vehicle[] | null;
};

export default function MaintenancePage() {
    const supabase = createClient();

    const [tenantId, setTenantId] = useState<string | null>(null);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [records, setRecords] = useState<MaintenanceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    const [vehicleId, setVehicleId] = useState("");
    const [maintenanceType, setMaintenanceType] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [completedDate, setCompletedDate] = useState("");
    const [status, setStatus] = useState("due");
    const [cost, setCost] = useState("");
    const [notes, setNotes] = useState("");

    async function resolveTenantId(): Promise<string> {
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return FALLBACK_TENANT_ID;
        }

        const { data, error } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("id", user.id)
            .maybeSingle();

        if (error || !data?.tenant_id) {
            return FALLBACK_TENANT_ID;
        }

        return data.tenant_id;
    }

    async function loadData(currentTenantId: string) {
        setLoading(true);
        setMessage("");

        const [
            { data: vehicleData, error: vehicleError },
            { data: maintenanceData, error: maintenanceError },
        ] = await Promise.all([
            supabase
                .from("vehicles")
                .select("id, tenant_id, registration, vehicle_type, make, model, active")
                .eq("tenant_id", currentTenantId)
                .order("registration", { ascending: true }),
            supabase
                .from("maintenance_records")
                .select(`
          id,
          vehicle_id,
          maintenance_type,
          due_date,
          completed_date,
          status,
          cost,
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
                .order("created_at", { ascending: false }),
        ]);

        if (vehicleError) {
            setMessage(vehicleError.message);
        }

        if (maintenanceError) {
            setMessage(maintenanceError.message);
        }

        const tenantVehicles: Vehicle[] = vehicleData ?? [];

        const normalizedMaintenance: MaintenanceRecord[] = (maintenanceData ?? []).map(
            (record: MaintenanceRecordRow) => ({
                ...record,
                vehicles: record.vehicles?.[0] ?? null,
            })
        );

        const filteredMaintenance = normalizedMaintenance.filter(
            (record) => record.vehicles?.tenant_id === currentTenantId
        );

        setVehicles(tenantVehicles);
        setRecords(filteredMaintenance);
        setLoading(false);
    }

    function resetForm() {
        setVehicleId("");
        setMaintenanceType("");
        setDueDate("");
        setCompletedDate("");
        setStatus("due");
        setCost("");
        setNotes("");
    }

    async function createRecord(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setMessage("");

        if (!tenantId) {
            setMessage("Tenant not loaded.");
            return;
        }

        if (!vehicleId) {
            setMessage("Please select a vehicle.");
            return;
        }

        if (!maintenanceType.trim()) {
            setMessage("Please enter a maintenance type.");
            return;
        }

        setSaving(true);

        const payload = {
            vehicle_id: vehicleId,
            maintenance_type: maintenanceType.trim(),
            due_date: dueDate || null,
            completed_date: completedDate || null,
            status,
            cost: cost ? Number(cost) : null,
            notes: notes.trim() || null,
        };

        const { error } = await supabase.from("maintenance_records").insert([payload]);

        if (error) {
            setMessage(error.message);
            setSaving(false);
            return;
        }

        if (status === "vor") {
            const { error: vehicleUpdateError } = await supabase
                .from("vehicles")
                .update({ active: false })
                .eq("id", vehicleId)
                .eq("tenant_id", tenantId);

            if (vehicleUpdateError) {
                setMessage(`Maintenance saved, but vehicle VOR update failed: ${vehicleUpdateError.message}`);
                setSaving(false);
                await loadData(tenantId);
                return;
            }
        }

        if (status === "completed") {
            await supabase
                .from("vehicles")
                .update({ active: true })
                .eq("id", vehicleId)
                .eq("tenant_id", tenantId);
        }

        resetForm();
        setMessage(status === "vor" ? "Maintenance record saved and vehicle marked VOR." : "Maintenance record added.");
        setSaving(false);
        await loadData(tenantId);
    }

    async function markVehicleRoadworthy(vehicleIdToRestore: string) {
        if (!tenantId) return;

        setMessage("");

        const { error } = await supabase
            .from("vehicles")
            .update({ active: true })
            .eq("id", vehicleIdToRestore)
            .eq("tenant_id", tenantId);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage("Vehicle marked roadworthy and activated.");
        await loadData(tenantId);
    }

    function vehicleLabel(vehicle: Vehicle) {
        const parts = [
            vehicle.registration || "No registration",
            vehicle.vehicle_type || null,
            [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null,
            vehicle.active === false ? "VOR / Inactive" : "Active",
        ].filter(Boolean);

        return parts.join(" • ");
    }

    useEffect(() => {
        async function init() {
            const resolvedTenantId = await resolveTenantId();
            setTenantId(resolvedTenantId);
            await loadData(resolvedTenantId);
        }

        init();
    }, []);

    const cardStyle: React.CSSProperties = {
        background: "rgba(255,255,255,0.95)",
        padding: 20,
        borderRadius: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
    };

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid #d1d5db",
        boxSizing: "border-box",
        fontSize: 14,
        background: "white",
    };

    const primaryButtonStyle: React.CSSProperties = {
        background: "#2563eb",
        color: "white",
        border: "none",
        borderRadius: 10,
        padding: 12,
        cursor: "pointer",
        fontWeight: 700,
    };

    const secondaryButtonStyle: React.CSSProperties = {
        background: "white",
        color: "#111827",
        border: "1px solid #d1d5db",
        borderRadius: 10,
        padding: "10px 14px",
        cursor: "pointer",
        fontWeight: 600,
    };

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 30,
                backgroundImage:
                    "url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d')",
                backgroundSize: "cover",
                backgroundPosition: "center",
            }}
        >
            <div
                style={{
                    background: "rgba(0,0,0,0.6)",
                    padding: 30,
                    borderRadius: 20,
                }}
            >
                <h1 style={{ color: "white", marginTop: 0, marginBottom: 20 }}>
                    Maintenance Records
                </h1>

                <form
                    onSubmit={createRecord}
                    style={{
                        ...cardStyle,
                        display: "grid",
                        gap: 12,
                        marginBottom: 20,
                    }}
                >
                    <select
                        value={vehicleId}
                        onChange={(event) => setVehicleId(event.target.value)}
                        style={inputStyle}
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
                        placeholder="Maintenance type"
                        value={maintenanceType}
                        onChange={(event) => setMaintenanceType(event.target.value)}
                        style={inputStyle}
                        required
                    />

                    <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        style={inputStyle}
                    />

                    <input
                        type="date"
                        value={completedDate}
                        onChange={(event) => setCompletedDate(event.target.value)}
                        style={inputStyle}
                    />

                    <select
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        style={inputStyle}
                    >
                        <option value="due">Due</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="overdue">Overdue</option>
                        <option value="vor">VOR</option>
                    </select>

                    <input
                        type="number"
                        step="0.01"
                        placeholder="Cost"
                        value={cost}
                        onChange={(event) => setCost(event.target.value)}
                        style={inputStyle}
                    />

                    <input
                        type="text"
                        placeholder="Notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        style={inputStyle}
                    />

                    <button
                        type="submit"
                        disabled={saving}
                        style={{
                            ...primaryButtonStyle,
                            cursor: saving ? "not-allowed" : "pointer",
                        }}
                    >
                        {saving ? "Saving..." : "Add record"}
                    </button>
                </form>

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
                            ...cardStyle,
                            marginBottom: 20,
                        }}
                    >
                        Loading...
                    </div>
                ) : null}

                <div
                    style={{
                        display: "grid",
                        gap: 16,
                    }}
                >
                    {records.map((record) => (
                        <div key={record.id} style={cardStyle}>
                            <h3 style={{ marginTop: 0, marginBottom: 8 }}>
                                {record.maintenance_type}
                            </h3>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Vehicle:{" "}
                                {record.vehicles?.registration ||
                                    [record.vehicles?.make, record.vehicles?.model].filter(Boolean).join(" ") ||
                                    record.vehicle_id}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Status: {record.status?.toUpperCase()}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Due: {record.due_date || "-"}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Completed: {record.completed_date || "-"}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 6 }}>
                                Cost: {record.cost !== null ? `£${record.cost}` : "-"}
                            </div>

                            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                Notes: {record.notes || "-"}
                            </div>

                            {record.status === "vor" ? (
                                <button
                                    type="button"
                                    style={secondaryButtonStyle}
                                    onClick={() => {
                                        if (record.vehicle_id) {
                                            markVehicleRoadworthy(record.vehicle_id);
                                        }
                                    }}
                                >
                                    Mark Roadworthy
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
