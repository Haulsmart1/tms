"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Select from "../../components/Select";
import Textarea from "../../components/Textarea";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import AssetCard from "./AssetCard";
import { PLACEHOLDER_ASSET, type Asset, type AssetType } from "./types";

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

const ASSET_COLUMNS = `
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
`;

export default function AssetsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);

  const [loading, setLoading] = useState(true);
  // Distinct from `loading`: this stays true across refetches, so a token
  // refresh cannot flash a skeleton over the cards already on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  // The tenant the cards on screen were loaded FOR. See
  // lib/loading/skeletonVisibility.ts for why this is three-valued.
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
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

  /* One region, one flag: the card grid is the only thing on this page that
     renders tenant data. The asset-type <select> feeds a form control, which
     skeletonVisibility deliberately excludes. */
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const loadAssets = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoading(true);

    const [assetResult, typeResult] = await Promise.all([
      tenant
        .filterByTenant(supabase.from("assets").select(ASSET_COLUMNS))
        .order("created_at", { ascending: false }),
      supabase.from("asset_types").select("id, name").order("name", { ascending: true }),
    ]);

    if (assetResult.error) {
      setErrorMessage(assetResult.error.message);
      setAssets([]);
    } else {
      setAssets((assetResult.data as unknown as Asset[]) ?? []);
      setDataTenantId(tenant.activeTenantId);
    }

    if (typeResult.error) {
      const typeMessage = typeResult.error.message;
      setErrorMessage((current) => (current ? `${current} | ${typeMessage}` : typeMessage));
      setAssetTypes([]);
    } else {
      setAssetTypes((typeResult.data as AssetType[]) ?? []);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void loadAssets();
    // loadAssets is rebuilt on every tenant context change; depending on the
    // two fields that actually matter keeps this to one fetch per switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  function handleAssetTypeChange(value: string) {
    setAssetTypeId(value);

    const selectedType = assetTypes.find((assetType) => assetType.id === value);

    if (selectedType) {
      setMechanical(DEFAULT_MECHANICAL_TYPES.has(selectedType.name));
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

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();

    if (tenant.status !== "ready") {
      setErrorMessage("Your tenant connection is not available.");
      return;
    }

    /* An admin viewing "All tenants" has no write target, so a new asset would
       have nowhere to land. Editing an existing row is still fine: it is
       matched by id and scoped by the row's own tenant. */
    const writeTenantId = tenant.writeTenantId;

    if (!editingAssetId && !writeTenantId) {
      setErrorMessage("Select a single tenant before adding an asset.");
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

    const selectedType = assetTypes.find((assetType) => assetType.id === assetTypeId);

    if (!selectedType) {
      setErrorMessage("The selected asset type is invalid.");
      return;
    }

    setSaving(true);

    try {
      /* The uniqueness rule is per tenant, so the check must be scoped to the
         tenant the row will live in, not to whatever is on screen: for an edit
         that is the row's existing tenant, for an insert the write target. */
      const duplicateTenantId = editingAssetId
        ? (assets.find((asset) => asset.id === editingAssetId)?.tenant_id ?? null)
        : writeTenantId;

      let duplicateQuery = supabase
        .from("assets")
        .select("id")
        .eq("asset_number", trimmedAssetNumber);

      if (duplicateTenantId) {
        duplicateQuery = duplicateQuery.eq("tenant_id", duplicateTenantId);
      }

      if (editingAssetId) {
        duplicateQuery = duplicateQuery.neq("id", editingAssetId);
      }

      const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1);

      if (duplicateError) {
        throw duplicateError;
      }

      if ((duplicate ?? []).length > 0) {
        throw new Error("Another asset in this tenant already uses that asset number.");
      }

      const trimmedBarcode = barcode.trim();
      const trimmedSerial = serialNumber.trim();

      const payload = {
        name: trimmedName,
        asset_number: trimmedAssetNumber,
        identifier_type: identifierType,
        asset_type_id: selectedType.id,
        asset_type: selectedType.name,
        reference: ["internal", "trailer_number", "container_number", "pallet_number"].includes(
          identifierType,
        )
          ? trimmedAssetNumber
          : null,
        registration: identifierType === "vrm" ? trimmedAssetNumber.toUpperCase() : null,
        serial_number:
          identifierType === "serial_number" && !trimmedSerial
            ? trimmedAssetNumber
            : trimmedSerial || null,
        barcode:
          identifierType === "barcode" && !trimmedBarcode
            ? trimmedAssetNumber
            : trimmedBarcode || null,
        mechanical,
        status,
        notes: notes.trim() || null,
      };

      if (editingAssetId) {
        /* No tenant_id/company_id in the update: an edit must never repoint a
           row at another tenant, and RLS already decides which rows this id is
           allowed to match. */
        const { error } = await supabase.from("assets").update(payload).eq("id", editingAssetId);

        if (error) {
          throw error;
        }

        setMessage("Asset updated.");
      } else {
        /* company_id comes from the TARGET TENANT, not from the tenant context.
           get_tenant_context() hands a super_admin every tenant in the platform
           while reporting their OWN company_id (rls_07), so stamping the context
           value would file another company's asset under the operator's company.
           Reading it off the tenants row is correct for all three roles, and RLS
           on `tenants` is what keeps this lookup honest. */
        const { data: tenantRow, error: tenantRowError } = await supabase
          .from("tenants")
          .select("company_id")
          .eq("id", writeTenantId)
          .maybeSingle();

        if (tenantRowError) {
          throw tenantRowError;
        }

        if (!tenantRow?.company_id) {
          throw new Error(
            "That tenant is not linked to a company. Ask an administrator to complete the company assignment.",
          );
        }

        const { error } = await supabase.from("assets").insert({
          ...payload,
          tenant_id: writeTenantId,
          company_id: String(tenantRow.company_id),
        });

        if (error) {
          throw error;
        }

        setMessage("Asset added.");
      }

      resetForm();
      await loadAssets();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save asset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-kicker uppercase text-ink-3">Fleet</div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Assets
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Track trailers, containers, pallets, plant, machinery and equipment.
              </p>
            </div>

            {showSkeleton ? null : (
              <Badge tone="neutral">
                {assets.length} asset{assets.length === 1 ? "" : "s"}
              </Badge>
            )}
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

          <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div>
              <h2 className="mb-1 text-md font-semibold text-ink">
                {editingAssetId ? "Edit Asset" : "Add Asset"}
              </h2>

              <p className="mb-3 text-sm text-ink-3">
                Asset numbers can be a VRM, trailer number, container number, pallet number,
                barcode, serial number or internal reference.
              </p>
            </div>

            <form onSubmit={saveAsset} className="grid gap-3 sm:grid-cols-2">
              <Field
                id="asset-name"
                label="Asset Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Curtainsider Trailer 12"
                required
              />

              <Field
                id="asset-number"
                label="Asset Number"
                value={assetNumber}
                onChange={(event) => setAssetNumber(event.target.value)}
                placeholder="e.g. TRL-012"
                required
              />

              <Select
                id="asset-identifier-type"
                label="Identifier Type"
                value={identifierType}
                onChange={(event) => setIdentifierType(event.target.value)}
              >
                {IDENTIFIER_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>

              <Select
                id="asset-type"
                label="Asset Type"
                value={assetTypeId}
                onChange={(event) => handleAssetTypeChange(event.target.value)}
                required
              >
                <option value="">Select asset type</option>

                {assetTypes.map((assetType) => (
                  <option key={assetType.id} value={assetType.id}>
                    {assetType.name}
                  </option>
                ))}
              </Select>

              <Field
                id="asset-serial-number"
                label="Serial Number"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
                placeholder="Optional serial number"
              />

              <Field
                id="asset-barcode"
                label="Barcode"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Scan or enter barcode"
              />

              <Select
                id="asset-status"
                label="Status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="inactive">Inactive</option>
              </Select>

              <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
                <input
                  type="checkbox"
                  checked={mechanical}
                  onChange={(event) => setMechanical(event.target.checked)}
                  className="mt-1"
                />

                <span className="min-w-0 text-sm text-ink">
                  <strong className="font-semibold">Mechanical Asset</strong>
                  <small className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-3">
                    Mechanical assets can be linked to maintenance records.
                  </small>
                </span>
              </label>

              <Textarea
                id="asset-notes"
                label="Notes"
                wrapperClassName="sm:col-span-2"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Asset notes..."
                rows={4}
                className="resize-y"
              />

              <div className="flex flex-wrap gap-2.5 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : editingAssetId ? "Save Changes" : "Add Asset"}
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
            <div>
              <h2 className="mb-1 text-md font-semibold text-ink">Asset Register</h2>

              <p className="mb-3 text-sm text-ink-3">
                {showSkeleton
                  ? "Loading the asset register."
                  : `${assets.length} registered asset${assets.length === 1 ? "" : "s"}.`}
              </p>
            </div>

            {showSkeleton ? (
              <div aria-busy className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
                <span className="sr-only" role="status">
                  Loading assets
                </span>

                {/* Six is a guess, the same one /customers makes. However many
                    assets arrive, this grid reflows: pixel-faithful fixes each
                    card's shape, not the count. */}
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <AssetCard
                    key={`asset-skeleton-${index}`}
                    loading
                    asset={PLACEHOLDER_ASSET}
                    onEdit={() => {}}
                  />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
                No assets have been added yet.
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
                {assets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onEdit={beginEdit} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </TenantGate>
  );
}
