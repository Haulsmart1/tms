"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

const FALLBACK_TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";
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

const pageBackground =
    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')";

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
    padding: "12px 14px",
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

const deleteButtonStyle: React.CSSProperties = {
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 600,
};

export default function VehicleLicencesPage() {
    const supabase = createClient();

    const [tenantId, setTenantId] = useState<string | null>(null);
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
            { data: licenceData, error: licenceError },
        ] = await Promise.all([
            supabase
                .from("vehicles")
                .select("id, tenant_id, registration, vehicle_type, make, model, active")
                .eq("tenant_id", currentTenantId)
                .order("registration", { ascending: true }),
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
                .eq("tenant_id", currentTenantId)
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
        async function init() {
            const resolved = await resolveTenantId();
            setTenantId(resolved);
            await loadData(resolved);
        }

        init();
    }, []);

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

        if (!tenantId) {
            setMessage("Tenant not loaded.");
            return;
        }

        if (!vehicleId) {
            setMessage("Please select a vehicle.");
            return;
        }

        if (!licenceType.trim()) {
            setMessage("Please enter a licence type.");
            return;
        }

        setSaving(true);

        const { error } = await supabase.from("vehicle_licences").insert([
            {
                tenant_id: tenantId,
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
        await loadData(tenantId);
    }

    async function deleteLicence(id: string) {
        if (!tenantId) return;
        if (!window.confirm("Delete licence?")) return;

        const { error } = await supabase
            .from("vehicle_licences")
            .delete()
            .eq("id", id)
            .eq("tenant_id", tenantId);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage("Licence deleted.");
        await loadData(tenantId);
    }

    async function toggleLicence(id: string, currentActive: boolean | null) {
        if (!tenantId) return;

        const { error } = await supabase
            .from("vehicle_licences")
            .update({ active: !currentActive })
            .eq("id", id)
            .eq("tenant_id", tenantId);

        if (error) {
            setMessage(error.message);
            return;
        }

        setMessage(!currentActive ? "Licence activated." : "Licence deactivated.");
        await loadData(tenantId);
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
        <main
            style={{
                minHeight: "100vh",
                padding: 30,
                backgroundImage: pageBackground,
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
                <div style={{ color: "white", marginBottom: 20 }}>
                    <h1 style={{ marginTop: 0, marginBottom: 8 }}>Vehicle Licences</h1>
                    <p style={{ margin: 0, opacity: 0.9 }}>
                        Add and manage vehicle licences. Billing is £10 per licensed vehicle per month.
                    </p>
                </div>

                <div
                    style={{
                        ...cardStyle,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 16,
                        marginBottom: 20,
                    }}
                >
                    <div>
                        <div style={{ fontSize: 13, opacity: 0.7 }}>Licensed Vehicles</div>
                        <div style={{ fontSize: 28, fontWeight: 800 }}>{billableVehicleCount}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 13, opacity: 0.7 }}>Monthly Charge</div>
                        <div style={{ fontSize: 28, fontWeight: 800 }}>£{monthlyTotal}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: 13, opacity: 0.7 }}>Billing Rule</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>£10 per licensed vehicle</div>
                    </div>
                </div>

                <form
                    onSubmit={createLicence}
                    style={{
                        ...cardStyle,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
                        placeholder="Licence type"
                        value={licenceType}
                        onChange={(event) => setLicenceType(event.target.value)}
                        style={inputStyle}
                        required
                    />

                    <input
                        type="date"
                        value={issueDate}
                        onChange={(event) => setIssueDate(event.target.value)}
                        style={inputStyle}
                    />

                    <input
                        type="date"
                        value={expiryDate}
                        onChange={(event) => setExpiryDate(event.target.value)}
                        style={inputStyle}
                    />

                    <input
                        type="text"
                        placeholder="Notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        style={inputStyle}
                    />

                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: "white",
                            border: "1px solid #d1d5db",
                            borderRadius: 10,
                            padding: "12px 14px",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={active}
                            onChange={(event) => setActive(event.target.checked)}
                        />
                        Active for billing
                    </label>

                    <button
                        type="submit"
                        disabled={saving}
                        style={{
                            ...primaryButtonStyle,
                            cursor: saving ? "not-allowed" : "pointer",
                        }}
                    >
                        {saving ? "Saving..." : "Add Licence"}
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
                    <div style={cardStyle}>Loading...</div>
                ) : (
                    <div style={{ display: "grid", gap: 16 }}>
                        {licences.map((licence) => (
                            <div
                                key={licence.id}
                                style={{
                                    ...cardStyle,
                                    display: "grid",
                                    gap: 8,
                                }}
                            >
                                <h3 style={{ margin: 0 }}>{licence.licence_type}</h3>

                                <div style={{ opacity: 0.8 }}>
                                    Vehicle:{" "}
                                    {licence.vehicles?.registration ||
                                        [licence.vehicles?.make, licence.vehicles?.model].filter(Boolean).join(" ") ||
                                        licence.vehicle_id}
                                </div>

                                <div style={{ opacity: 0.8 }}>
                                    Issue Date: {licence.issue_date || "-"}
                                </div>

                                <div style={{ opacity: 0.8 }}>
                                    Expiry Date: {licence.expiry_date || "-"}
                                </div>

                                <div style={{ opacity: 0.8 }}>
                                    Billing Status: {licence.active ? "Active" : "Inactive"}
                                </div>

                                <div style={{ opacity: 0.8 }}>
                                    Notes: {licence.notes || "-"}
                                </div>

                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                    <button
                                        type="button"
                                        style={secondaryButtonStyle}
                                        onClick={() => toggleLicence(licence.id, licence.active)}
                                    >
                                        {licence.active ? "Deactivate" : "Activate"}
                                    </button>

                                    <button
                                        type="button"
                                        style={deleteButtonStyle}
                                        onClick={() => deleteLicence(licence.id)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
