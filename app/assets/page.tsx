"use client";

import {
    CSSProperties,
    FormEvent,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { createClient } from "../../lib/supabase/browser";

type AssetType = {
    id: string;
    name: string;
};

type Asset = {
    id: string;
    company_id: string;
    tenant_id: string;
    name: string;
    asset_type: string;
    asset_type_id: string | null;
    asset_number: string | null;
    identifier_type: string | null;
    reference: string | null;
    serial_number: string | null;
    registration: string | null;
    barcode: string | null;
    mechanical: boolean;
    status: string | null;
    notes: string | null;
    created_at: string | null;
};

const IDENTIFIER_TYPES = [
    ["internal", "Internal Asset Number"],
    ["vrm", "VRM / Registration"],
    ["trailer_number", "Trailer Number"],
    ["container_number", "Container Number"],
    ["pallet_number", "Pallet Number"],
    ["barcode", "Barcode"],
    ["serial_number", "Serial Number"],
] as const;

const DEFAULT_MECHANICAL_TYPES = new Set([
    "Trailer",
    "Forklift",
    "Fridge Unit",
    "Generator",
    "Plant / Machinery",
]);

export default function AssetsPage() {
    const supabase = useMemo(() => createClient(), []);

    const [tenantId, setTenantId] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState<string | null>(null);

    const [assets, setAssets] = useState<Asset[]>([]);
    const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const [editingAssetId, setEditingAssetId] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [assetNumber, setAssetNumber] = useState("");
    const [identifierType, setIdentifierType] = useState("internal");
    const [assetTypeId, setAssetTypeId] = useState("");
    const [serialNumber, setSerialNumber] = useState("");
    const [barcode, setBarcode] = useState("");
    const [mechanical, setMechanical] = useState(false);
    const [status, setStatus] = useState("active");
    const [notes, setNotes] = useState("");

    const clearMessages = useCallback(() => {
        setMessage("");
        setErrorMessage("");
    }, []);

    const resetForm = useCallback(() => {
        setEditingAssetId(null);
        setName("");
        setAssetNumber("");
        setIdentifierType("internal");
        setAssetTypeId("");
        setSerialNumber("");
        setBarcode("");
        setMechanical(false);
        setStatus("active");
        setNotes("");
    }, []);

    const loadAssets = useCallback(
        async (currentTenantId: string) => {
            const { data, error } = await supabase
                .from("assets")
                .select(`
                    id,
                    company_id,
                    tenant_id,
                    name,
                    asset_type,
                    asset_type_id,
                    asset_number,
                    identifier_type,
                    reference,
                    serial_number,
                    registration,
                    barcode,
                    mechanical,
                    status,
                    notes,
                    created_at
                `)
                .eq("tenant_id", currentTenantId)
                .order("created_at", {
                    ascending: false,
                });

            if (error) {
                throw error;
            }

            setAssets((data ?? []) as Asset[]);
        },
        [supabase]
    );

    const initialise = useCallback(async () => {
        setLoading(true);
        clearMessages();

        try {
            const {
                data: { user },
                error: userError,
            } = await supabase.auth.getUser();

            if (userError) {
                throw userError;
            }

            if (!user) {
                throw new Error("You must be signed in to manage assets.");
            }

            const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("tenant_id, company_id")
                .eq("id", user.id)
                .maybeSingle();

            if (profileError) {
                throw profileError;
            }

            if (!profile?.tenant_id) {
                throw new Error(
                    "Your account is not linked to a TMS tenant."
                );
            }

            if (!profile.company_id) {
                throw new Error(
                    "Your account is linked to a tenant but not to a company. Ask an administrator to complete your company assignment."
                );
            }

            const currentTenantId = String(profile.tenant_id);
            const currentCompanyId = String(profile.company_id);

            setTenantId(currentTenantId);
            setCompanyId(currentCompanyId);

            const { data: types, error: typesError } = await supabase
                .from("asset_types")
                .select("id, name")
                .order("name", {
                    ascending: true,
                });

            if (typesError) {
                throw typesError;
            }

            setAssetTypes((types ?? []) as AssetType[]);

            await loadAssets(currentTenantId);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to load assets."
            );
        } finally {
            setLoading(false);
        }
    }, [clearMessages, loadAssets, supabase]);

    useEffect(() => {
        void initialise();
    }, [initialise]);

    function handleAssetTypeChange(value: string) {
        setAssetTypeId(value);

        const selectedType = assetTypes.find(
            (assetType) => assetType.id === value
        );

        if (selectedType) {
            setMechanical(
                DEFAULT_MECHANICAL_TYPES.has(selectedType.name)
            );
        }
    }

    function beginEdit(asset: Asset) {
        clearMessages();

        setEditingAssetId(asset.id);
        setName(asset.name ?? "");
        setAssetNumber(asset.asset_number ?? "");
        setIdentifierType(asset.identifier_type ?? "internal");
        setAssetTypeId(asset.asset_type_id ?? "");
        setSerialNumber(asset.serial_number ?? "");
        setBarcode(asset.barcode ?? "");
        setMechanical(Boolean(asset.mechanical));
        setStatus(asset.status ?? "active");
        setNotes(asset.notes ?? "");

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }

    async function saveAsset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        clearMessages();

        if (!tenantId || !companyId) {
            setErrorMessage(
                "Your tenant/company connection is not available."
            );
            return;
        }

        const trimmedName = name.trim();
        const trimmedAssetNumber = assetNumber.trim();

        if (!trimmedName) {
            setErrorMessage("Asset name is required.");
            return;
        }

        if (!trimmedAssetNumber) {
            setErrorMessage("Asset number is required.");
            return;
        }

        if (!assetTypeId) {
            setErrorMessage("Select an asset type.");
            return;
        }

        const selectedType = assetTypes.find(
            (assetType) => assetType.id === assetTypeId
        );

        if (!selectedType) {
            setErrorMessage("The selected asset type is invalid.");
            return;
        }

        setSaving(true);

        try {
            let duplicateQuery = supabase
                .from("assets")
                .select("id")
                .eq("tenant_id", tenantId)
                .eq("asset_number", trimmedAssetNumber);

            if (editingAssetId) {
                duplicateQuery = duplicateQuery.neq(
                    "id",
                    editingAssetId
                );
            }

            const { data: duplicate, error: duplicateError } =
                await duplicateQuery.limit(1);

            if (duplicateError) {
                throw duplicateError;
            }

            if ((duplicate ?? []).length > 0) {
                throw new Error(
                    "Another asset in this tenant already uses that asset number."
                );
            }

            const trimmedBarcode = barcode.trim();
            const trimmedSerial = serialNumber.trim();

            const payload = {
                tenant_id: tenantId,
                company_id: companyId,
                name: trimmedName,
                asset_number: trimmedAssetNumber,
                identifier_type: identifierType,
                asset_type_id: selectedType.id,
                asset_type: selectedType.name,
                reference: [
                    "internal",
                    "trailer_number",
                    "container_number",
                    "pallet_number",
                ].includes(identifierType)
                    ? trimmedAssetNumber
                    : null,
                registration:
                    identifierType === "vrm"
                        ? trimmedAssetNumber.toUpperCase()
                        : null,
                serial_number:
                    identifierType === "serial_number" &&
                    !trimmedSerial
                        ? trimmedAssetNumber
                        : trimmedSerial || null,
                barcode:
                    identifierType === "barcode" &&
                    !trimmedBarcode
                        ? trimmedAssetNumber
                        : trimmedBarcode || null,
                mechanical,
                status,
                notes: notes.trim() || null,
            };

            if (editingAssetId) {
                const { error } = await supabase
                    .from("assets")
                    .update(payload)
                    .eq("id", editingAssetId)
                    .eq("tenant_id", tenantId);

                if (error) {
                    throw error;
                }

                setMessage("Asset updated.");
            } else {
                const { error } = await supabase
                    .from("assets")
                    .insert(payload);

                if (error) {
                    throw error;
                }

                setMessage("Asset added.");
            }

            resetForm();
            await loadAssets(tenantId);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "Unable to save asset."
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <main style={styles.page}>
            <div style={styles.shell}>
                <header style={styles.header}>
                    <div>
                        <h1 style={styles.title}>Assets</h1>
                        <p style={styles.subtitle}>
                            Track trailers, containers, pallets, plant,
                            machinery and equipment.
                        </p>
                    </div>

                    <div style={styles.counter}>
                        {assets.length} asset
                        {assets.length === 1 ? "" : "s"}
                    </div>
                </header>

                {errorMessage ? (
                    <div style={styles.error}>{errorMessage}</div>
                ) : null}

                {message ? (
                    <div style={styles.success}>{message}</div>
                ) : null}

                <section style={styles.panel}>
                    <div style={styles.sectionHeading}>
                        <div>
                            <h2 style={styles.sectionTitle}>
                                {editingAssetId
                                    ? "Edit Asset"
                                    : "Add Asset"}
                            </h2>

                            <p style={styles.sectionDescription}>
                                Asset numbers can be a VRM, trailer number,
                                container number, pallet number, barcode,
                                serial number or internal reference.
                            </p>
                        </div>
                    </div>

                    <form
                        onSubmit={saveAsset}
                        style={styles.form}
                    >
                        <label style={styles.field}>
                            <span style={styles.label}>
                                Asset Name
                            </span>

                            <input
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder="e.g. Curtainsider Trailer 12"
                                style={styles.input}
                                required
                            />
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Asset Number
                            </span>

                            <input
                                value={assetNumber}
                                onChange={(event) =>
                                    setAssetNumber(
                                        event.target.value
                                    )
                                }
                                placeholder="e.g. TRL-012"
                                style={styles.input}
                                required
                            />
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Identifier Type
                            </span>

                            <select
                                value={identifierType}
                                onChange={(event) =>
                                    setIdentifierType(
                                        event.target.value
                                    )
                                }
                                style={styles.input}
                            >
                                {IDENTIFIER_TYPES.map(
                                    ([value, label]) => (
                                        <option
                                            key={value}
                                            value={value}
                                        >
                                            {label}
                                        </option>
                                    )
                                )}
                            </select>
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Asset Type
                            </span>

                            <select
                                value={assetTypeId}
                                onChange={(event) =>
                                    handleAssetTypeChange(
                                        event.target.value
                                    )
                                }
                                style={styles.input}
                                required
                            >
                                <option value="">
                                    Select asset type
                                </option>

                                {assetTypes.map((assetType) => (
                                    <option
                                        key={assetType.id}
                                        value={assetType.id}
                                    >
                                        {assetType.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Serial Number
                            </span>

                            <input
                                value={serialNumber}
                                onChange={(event) =>
                                    setSerialNumber(
                                        event.target.value
                                    )
                                }
                                placeholder="Optional serial number"
                                style={styles.input}
                            />
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Barcode
                            </span>

                            <input
                                value={barcode}
                                onChange={(event) =>
                                    setBarcode(event.target.value)
                                }
                                placeholder="Scan or enter barcode"
                                style={styles.input}
                            />
                        </label>

                        <label style={styles.field}>
                            <span style={styles.label}>
                                Status
                            </span>

                            <select
                                value={status}
                                onChange={(event) =>
                                    setStatus(event.target.value)
                                }
                                style={styles.input}
                            >
                                <option value="active">
                                    Active
                                </option>
                                <option value="maintenance">
                                    Maintenance
                                </option>
                                <option value="inactive">
                                    Inactive
                                </option>
                            </select>
                        </label>

                        <label style={styles.checkboxField}>
                            <input
                                type="checkbox"
                                checked={mechanical}
                                onChange={(event) =>
                                    setMechanical(
                                        event.target.checked
                                    )
                                }
                            />

                            <span>
                                <strong>
                                    Mechanical Asset
                                </strong>
                                <small style={styles.helper}>
                                    Mechanical assets can be linked to
                                    maintenance records.
                                </small>
                            </span>
                        </label>

                        <label
                            style={{
                                ...styles.field,
                                gridColumn: "1 / -1",
                            }}
                        >
                            <span style={styles.label}>
                                Notes
                            </span>

                            <textarea
                                value={notes}
                                onChange={(event) =>
                                    setNotes(event.target.value)
                                }
                                placeholder="Asset notes..."
                                rows={4}
                                style={{
                                    ...styles.input,
                                    resize: "vertical",
                                }}
                            />
                        </label>

                        <div style={styles.actions}>
                            <button
                                type="submit"
                                disabled={saving}
                                style={{
                                    ...styles.primaryButton,
                                    opacity: saving ? 0.65 : 1,
                                }}
                            >
                                {saving
                                    ? "Saving..."
                                    : editingAssetId
                                      ? "Save Changes"
                                      : "Add Asset"}
                            </button>

                            {editingAssetId ? (
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => {
                                        resetForm();
                                        clearMessages();
                                    }}
                                    style={styles.secondaryButton}
                                >
                                    Cancel
                                </button>
                            ) : null}
                        </div>
                    </form>
                </section>

                <section style={styles.panel}>
                    <div style={styles.sectionHeading}>
                        <div>
                            <h2 style={styles.sectionTitle}>
                                Asset Register
                            </h2>

                            <p style={styles.sectionDescription}>
                                {assets.length} registered asset
                                {assets.length === 1 ? "" : "s"}.
                            </p>
                        </div>
                    </div>

                    {loading ? (
                        <div style={styles.empty}>
                            Loading assets...
                        </div>
                    ) : assets.length === 0 ? (
                        <div style={styles.empty}>
                            No assets have been added yet.
                        </div>
                    ) : (
                        <div style={styles.grid}>
                            {assets.map((asset) => (
                                <article
                                    key={asset.id}
                                    style={styles.card}
                                >
                                    <div style={styles.cardHeader}>
                                        <div>
                                            <h3 style={styles.cardTitle}>
                                                {asset.name}
                                            </h3>

                                            <div
                                                style={
                                                    styles.assetNumber
                                                }
                                            >
                                                {asset.asset_number ||
                                                    "No asset number"}
                                            </div>
                                        </div>

                                        <span
                                            style={statusBadgeStyle(
                                                asset.status
                                            )}
                                        >
                                            {formatLabel(
                                                asset.status ||
                                                    "active"
                                            )}
                                        </span>
                                    </div>

                                    <div style={styles.details}>
                                        <AssetDetail
                                            label="Type"
                                            value={
                                                asset.asset_type
                                            }
                                        />

                                        <AssetDetail
                                            label="Identifier"
                                            value={formatLabel(
                                                asset.identifier_type ||
                                                    "internal"
                                            )}
                                        />

                                        <AssetDetail
                                            label="Mechanical"
                                            value={
                                                asset.mechanical
                                                    ? "Yes"
                                                    : "No"
                                            }
                                        />

                                        <AssetDetail
                                            label="Serial"
                                            value={
                                                asset.serial_number ||
                                                "—"
                                            }
                                        />

                                        <AssetDetail
                                            label="Barcode"
                                            value={
                                                asset.barcode || "—"
                                            }
                                        />

                                        <AssetDetail
                                            label="Registration"
                                            value={
                                                asset.registration ||
                                                "—"
                                            }
                                        />
                                    </div>

                                    {asset.notes ? (
                                        <div style={styles.notes}>
                                            {asset.notes}
                                        </div>
                                    ) : null}

                                    {asset.mechanical ? (
                                        <div style={styles.mechanicalTag}>
                                            Maintenance enabled
                                        </div>
                                    ) : null}

                                    <button
                                        type="button"
                                        onClick={() =>
                                            beginEdit(asset)
                                        }
                                        style={styles.secondaryButton}
                                    >
                                        Edit Asset
                                    </button>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

function AssetDetail({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div>
            <span style={styles.smallLabel}>
                {label}
            </span>

            <strong style={styles.detailValue}>
                {value}
            </strong>
        </div>
    );
}

function formatLabel(value: string) {
    return value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) =>
            character.toUpperCase()
        );
}

function statusBadgeStyle(
    status: string | null
): CSSProperties {
    const base: CSSProperties = {
        display: "inline-flex",
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: "nowrap",
    };

    if (status === "inactive") {
        return {
            ...base,
            background: "#fee2e2",
            color: "#991b1b",
        };
    }

    if (status === "maintenance") {
        return {
            ...base,
            background: "#fef3c7",
            color: "#92400e",
        };
    }

    return {
        ...base,
        background: "#dcfce7",
        color: "#166534",
    };
}

const styles: Record<string, CSSProperties> = {
    page: {
        minHeight: "100vh",
        padding: 30,
        background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    },

    shell: {
        maxWidth: 1500,
        margin: "0 auto",
        display: "grid",
        gap: 24,
    },

    header: {
        display: "flex",
        justifyContent: "space-between",
        gap: 20,
        alignItems: "flex-start",
        flexWrap: "wrap",
        color: "white",
    },

    title: {
        margin: 0,
        fontSize: 34,
    },

    subtitle: {
        margin: "7px 0 0",
        color: "#cbd5e1",
        lineHeight: 1.5,
    },

    counter: {
        padding: "8px 12px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.12)",
        color: "white",
        fontWeight: 800,
    },

    panel: {
        background: "rgba(255,255,255,0.98)",
        borderRadius: 18,
        padding: 24,
        boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
    },

    sectionHeading: {
        marginBottom: 20,
    },

    sectionTitle: {
        margin: 0,
        color: "#0f172a",
        fontSize: 22,
    },

    sectionDescription: {
        margin: "6px 0 0",
        color: "#64748b",
        lineHeight: 1.5,
    },

    form: {
        display: "grid",
        gridTemplateColumns:
            "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
    },

    field: {
        display: "grid",
        gap: 7,
    },

    checkboxField: {
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: 12,
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        background: "#f8fafc",
    },

    helper: {
        display: "block",
        marginTop: 3,
        color: "#64748b",
        fontWeight: 400,
        lineHeight: 1.4,
    },

    label: {
        color: "#334155",
        fontSize: 13,
        fontWeight: 800,
    },

    input: {
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid #cbd5e1",
        borderRadius: 9,
        padding: "11px 12px",
        background: "white",
        color: "#0f172a",
        fontSize: 14,
    },

    actions: {
        gridColumn: "1 / -1",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
    },

    primaryButton: {
        padding: "11px 16px",
        border: "none",
        borderRadius: 9,
        background: "#2563eb",
        color: "white",
        fontWeight: 800,
        cursor: "pointer",
    },

    secondaryButton: {
        padding: "9px 13px",
        border: "1px solid #cbd5e1",
        borderRadius: 9,
        background: "white",
        color: "#0f172a",
        fontWeight: 800,
        cursor: "pointer",
    },

    error: {
        padding: 14,
        borderRadius: 10,
        background: "#fee2e2",
        color: "#991b1b",
        fontWeight: 700,
    },

    success: {
        padding: 14,
        borderRadius: 10,
        background: "#dcfce7",
        color: "#166534",
        fontWeight: 700,
    },

    empty: {
        padding: 30,
        textAlign: "center",
        color: "#64748b",
        background: "#f8fafc",
        borderRadius: 12,
    },

    grid: {
        display: "grid",
        gridTemplateColumns:
            "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 18,
    },

    card: {
        padding: 20,
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        background: "#ffffff",
        display: "grid",
        gap: 16,
    },

    cardHeader: {
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
    },

    cardTitle: {
        margin: 0,
        color: "#0f172a",
        fontSize: 19,
    },

    assetNumber: {
        marginTop: 5,
        color: "#2563eb",
        fontWeight: 900,
        fontSize: 15,
    },

    details: {
        display: "grid",
        gridTemplateColumns:
            "repeat(2, minmax(0, 1fr))",
        gap: 12,
    },

    smallLabel: {
        display: "block",
        color: "#94a3b8",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 800,
        fontSize: 10,
        marginBottom: 3,
    },

    detailValue: {
        display: "block",
        color: "#334155",
        fontSize: 13,
        overflowWrap: "anywhere",
    },

    notes: {
        padding: 12,
        borderRadius: 9,
        background: "#f8fafc",
        color: "#475569",
        lineHeight: 1.5,
    },

    mechanicalTag: {
        width: "fit-content",
        padding: "6px 9px",
        borderRadius: 999,
        background: "#dbeafe",
        color: "#1d4ed8",
        fontSize: 12,
        fontWeight: 800,
    },
};