"use client";

import {
    FormEvent,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import Badge, { type Tone } from "../../components/Badge";
import Button from "../../components/Button";
import Field from "../../components/Field";
import Textarea from "../../components/Textarea";

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
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">
                <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                            Assets
                        </h1>
                        <p className="text-sm text-ink-3">
                            Track trailers, containers, pallets, plant,
                            machinery and equipment.
                        </p>
                    </div>

                    <Badge tone="neutral">
                        {assets.length} asset
                        {assets.length === 1 ? "" : "s"}
                    </Badge>
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

                <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                    <div className="min-w-0">
                        <h2 className="mb-1 text-md font-semibold text-ink">
                            {editingAssetId
                                ? "Edit Asset"
                                : "Add Asset"}
                        </h2>

                        <p className="mb-3 text-sm text-ink-3">
                            Asset numbers can be a VRM, trailer number,
                            container number, pallet number, barcode,
                            serial number or internal reference.
                        </p>
                    </div>

                    <form
                        onSubmit={saveAsset}
                        className="grid gap-3 sm:grid-cols-2"
                    >
                        <Field
                            id="asset-name"
                            label="Asset Name"
                            value={name}
                            onChange={(event) =>
                                setName(event.target.value)
                            }
                            placeholder="e.g. Curtainsider Trailer 12"
                            required
                        />

                        <Field
                            id="asset-number"
                            label="Asset Number"
                            value={assetNumber}
                            onChange={(event) =>
                                setAssetNumber(
                                    event.target.value
                                )
                            }
                            placeholder="e.g. TRL-012"
                            required
                        />

                        <label className="grid gap-1.5">
                            <span className="text-sm font-medium text-ink-2">
                                Identifier Type
                            </span>

                            <select
                                value={identifierType}
                                onChange={(event) =>
                                    setIdentifierType(
                                        event.target.value
                                    )
                                }
                                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
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

                        <label className="grid gap-1.5">
                            <span className="text-sm font-medium text-ink-2">
                                Asset Type
                            </span>

                            <select
                                value={assetTypeId}
                                onChange={(event) =>
                                    handleAssetTypeChange(
                                        event.target.value
                                    )
                                }
                                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
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

                        <Field
                            id="asset-serial-number"
                            label="Serial Number"
                            value={serialNumber}
                            onChange={(event) =>
                                setSerialNumber(
                                    event.target.value
                                )
                            }
                            placeholder="Optional serial number"
                        />

                        <Field
                            id="asset-barcode"
                            label="Barcode"
                            value={barcode}
                            onChange={(event) =>
                                setBarcode(event.target.value)
                            }
                            placeholder="Scan or enter barcode"
                        />

                        <label className="grid gap-1.5">
                            <span className="text-sm font-medium text-ink-2">
                                Status
                            </span>

                            <select
                                value={status}
                                onChange={(event) =>
                                    setStatus(event.target.value)
                                }
                                className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
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

                        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
                            <input
                                type="checkbox"
                                checked={mechanical}
                                onChange={(event) =>
                                    setMechanical(
                                        event.target.checked
                                    )
                                }
                                className="mt-1"
                            />

                            <span className="min-w-0 text-sm text-ink">
                                <strong className="font-semibold">
                                    Mechanical Asset
                                </strong>
                                <small className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-3">
                                    Mechanical assets can be linked to
                                    maintenance records.
                                </small>
                            </span>
                        </label>

                        <Textarea
                            id="asset-notes"
                            label="Notes"
                            wrapperClassName="sm:col-span-2"
                            value={notes}
                            onChange={(event) =>
                                setNotes(event.target.value)
                            }
                            placeholder="Asset notes..."
                            rows={4}
                            className="resize-y"
                        />

                        <div className="flex flex-wrap gap-2.5 sm:col-span-2">
                            <Button
                                type="submit"
                                disabled={saving}
                            >
                                {saving
                                    ? "Saving..."
                                    : editingAssetId
                                      ? "Save Changes"
                                      : "Add Asset"}
                            </Button>

                            {editingAssetId ? (
                                <Button
                                    variant="secondary"
                                    disabled={saving}
                                    onClick={() => {
                                        resetForm();
                                        clearMessages();
                                    }}
                                >
                                    Cancel
                                </Button>
                            ) : null}
                        </div>
                    </form>
                </section>

                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                    <div className="min-w-0">
                        <h2 className="mb-1 text-md font-semibold text-ink">
                            Asset Register
                        </h2>

                        <p className="mb-3 text-sm text-ink-3">
                            {assets.length} registered asset
                            {assets.length === 1 ? "" : "s"}.
                        </p>
                    </div>

                    {loading ? (
                        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                            Loading assets...
                        </div>
                    ) : assets.length === 0 ? (
                        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                            No assets have been added yet.
                        </div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
                            {assets.map((asset) => (
                                <article
                                    key={asset.id}
                                    className="grid content-start gap-4 rounded-lg border border-line bg-surface-2 p-4"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="break-words text-md font-semibold text-ink">
                                                {asset.name}
                                            </h3>

                                            <div className="mt-1 break-words text-sm font-semibold text-primary-deep">
                                                {asset.asset_number ||
                                                    "No asset number"}
                                            </div>
                                        </div>

                                        <Badge
                                            tone={statusTone(
                                                asset.status
                                            )}
                                        >
                                            {formatLabel(
                                                asset.status ||
                                                    "active"
                                            )}
                                        </Badge>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
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
                                        <div className="break-words rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-ink-2">
                                            {asset.notes}
                                        </div>
                                    ) : null}

                                    {asset.mechanical ? (
                                        <div>
                                            <Badge tone="info">
                                                Maintenance enabled
                                            </Badge>
                                        </div>
                                    ) : null}

                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() =>
                                            beginEdit(asset)
                                        }
                                    >
                                        Edit Asset
                                    </Button>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
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

function formatLabel(value: string) {
    return value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) =>
            character.toUpperCase()
        );
}

function statusTone(status: string | null): Tone {
    if (status === "inactive") {
        return "danger";
    }

    if (status === "maintenance") {
        return "warning";
    }

    return "success";
}