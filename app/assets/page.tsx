"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import DataTable, { type Column, type DataTableState } from "../../components/DataTable";
import MessageBanner from "../../components/MessageBanner";
import SearchInput from "../../components/SearchInput";
import Select from "../../components/Select";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { isMissingColumnError } from "../../lib/assets/errors";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterAssets,
  hasActiveFilters,
  identifierSummary,
  isArchived,
  nextSort,
  sortAssets,
  type AssetFilters,
  type AssetSort,
  type MechanicalFilter,
  type SortKey,
  type StatusFilter,
} from "../../lib/assets/register";
import {
  ASSET_STATUSES,
  type Asset,
  type AssetFormValues,
  type AssetType,
} from "../../lib/assets/types";
import AssetDialog from "./AssetDialog";
import StatusBadge from "./StatusBadge";
import { saveAsset } from "./saveAsset";

const BASE_COLUMNS = `
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

/* docs/sql/assets_01 adds these. Without it the first select fails with 42703
   and the page reloads with BASE_COLUMNS and hides the archive controls. */
const ARCHIVE_COLUMNS = `${BASE_COLUMNS}, archived_at, archived_by`;

const COLUMNS: Column<Asset>[] = [
  {
    header: "Asset",
    sortKey: "name",
    cell: (asset) => <span className="font-semibold text-ink">{asset.name}</span>,
  },
  { header: "Number", sortKey: "number", cell: (asset) => asset.asset_number || "-" },
  { header: "Type", sortKey: "type", cell: (asset) => asset.asset_type || "-" },
  { header: "Identifier", cell: (asset) => identifierSummary(asset) || "-" },
  { header: "Status", sortKey: "status", cell: (asset) => <StatusBadge asset={asset} /> },
  {
    header: "Mechanical",
    sortKey: "mechanical",
    cell: (asset) => (asset.mechanical ? "Yes" : "No"),
  },
];

type DialogState = { key: number; assetId: string | null; mode: "view" | "edit" };

type AssetAction = "archive" | "restore" | "delete";

const ACTION_DONE: Record<AssetAction, string> = {
  archive: "Asset archived.",
  restore: "Asset restored.",
  delete: "Asset deleted.",
};

async function callAssetRoute(assetId: string, action: AssetAction): Promise<string | null> {
  const id = encodeURIComponent(assetId);
  const response = await fetch(
    action === "delete" ? `/api/assets/${id}` : `/api/assets/${id}/${action}`,
    { method: action === "delete" ? "DELETE" : "POST" },
  );
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || "Something went wrong. Please try again.";
}

export default function AssetsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [assets, setAssets] = useState<Asset[]>([]);
  const loadSeqRef = useRef(0);
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([]);

  const [loading, setLoading] = useState(true);
  // Distinct from `loading`: this stays true across refetches, so a token
  // refresh cannot flash a skeleton over the rows already on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
  // The tenant the rows on screen were loaded FOR. See
  // lib/loading/skeletonVisibility.ts for why this is three-valued.
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [typeError, setTypeError] = useState("");
  const [archiveSupported, setArchiveSupported] = useState<boolean | null>(null);

  /* useTenant() folds drivers into "staff", so ask the database. null means
     unknown (the function is not installed yet): show the controls and let
     RLS refuse, rather than hide them from office staff. */
  const [isOffice, setIsOffice] = useState<boolean | null>(null);

  const [filters, setFilters] = useState<AssetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<AssetSort>(DEFAULT_SORT);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogKeyRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [message, setMessage] = useState("");

  /* One region, one flag: the table is the only thing on this page that
     renders tenant data. The type <select>s feed form controls, which
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

    /* SET-18: latest request wins, so a slow response for the tenant the
       user just switched away from cannot replace the new list. */
    const seq = ++loadSeqRef.current;

    setLoading(true);

    const fetchAssets = (columns: string) =>
      tenant
        .filterByTenant(supabase.from("assets").select(columns))
        .order("created_at", { ascending: false });

    const [firstResult, typeResult] = await Promise.all([
      fetchAssets(ARCHIVE_COLUMNS),
      supabase.from("asset_types").select("id, name").order("name", { ascending: true }),
    ]);

    let assetResult = firstResult;
    let supported = true;
    if (firstResult.error && isMissingColumnError(firstResult.error)) {
      supported = false;
      assetResult = await fetchAssets(BASE_COLUMNS);
    }

    if (seq !== loadSeqRef.current) return;

    if (assetResult.error) {
      setLoadError(assetResult.error.message);
      // Keep the rows (the open dialog reads from them) unless they belong
      // to a different tenant than the one now active.
      if (dataTenantId !== tenant.activeTenantId) setAssets([]);
    } else {
      setLoadError("");
      setAssets((assetResult.data as unknown as Asset[]) ?? []);
      setArchiveSupported(supported);
      setDataTenantId(tenant.activeTenantId);
    }

    if (typeResult.error) {
      setTypeError(typeResult.error.message);
      setAssetTypes([]);
    } else {
      setTypeError("");
      setAssetTypes((typeResult.data as AssetType[]) ?? []);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant, dataTenantId]);

  const loadAssetsRef = useRef(loadAssets);
  useEffect(() => {
    loadAssetsRef.current = loadAssets;
  });

  useEffect(() => {
    void loadAssets();
    // loadAssets is rebuilt on every tenant context change; depending on the
    // two fields that actually matter keeps this to one fetch per switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("pod_caller_is_office").then(({ data, error }) => {
      if (!cancelled) setIsOffice(error ? null : data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const visibleAssets = useMemo(
    () => sortAssets(filterAssets(assets, filters), sort),
    [assets, filters, sort],
  );
  const activeCount = useMemo(() => assets.filter((asset) => !isArchived(asset)).length, [assets]);
  const filtering = hasActiveFilters(filters);

  const allArchivedHidden =
    assets.length > 0 && !filtering && !filters.showArchived && visibleAssets.length === 0;

  const canWrite = isOffice !== false;
  const canDelete = canWrite && (tenant.role === "admin" || tenant.role === "super_admin");
  const dialogAsset = dialog?.assetId
    ? (assets.find((asset) => asset.id === dialog.assetId) ?? null)
    : null;

  useEffect(() => {
    if (dialog?.assetId && !dialogAsset && !busy) {
      setDialog(null);
      setMessage("That asset is no longer available.");
    }
  }, [dialog, dialogAsset, busy]);

  const tableState: DataTableState = showSkeleton
    ? "loading"
    : loadError
      ? "error"
      : visibleAssets.length === 0
        ? "empty"
        : "ready";

  function openDialog(assetId: string | null, mode: "view" | "edit") {
    setMessage("");
    setDialogError("");
    dialogKeyRef.current += 1;
    setDialog({ key: dialogKeyRef.current, assetId, mode });
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setDialogError("");
  }

  async function handleSave(values: AssetFormValues) {
    if (tenant.status !== "ready") {
      setDialogError("Your tenant connection is not available.");
      return;
    }

    setBusy(true);
    setDialogError("");

    try {
      const outcome = await saveAsset({
        supabase,
        values,
        editing: dialogAsset,
        writeTenantId: tenant.writeTenantId,
        assetTypes,
      });
      setDialog(null);
      setMessage(outcome === "added" ? "Asset added." : "Asset updated.");
      await loadAssetsRef.current();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Unable to save asset.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action: AssetAction) {
    if (!dialogAsset) return;

    setBusy(true);
    setDialogError("");

    try {
      const failure = await callAssetRoute(dialogAsset.id, action).catch(
        () => "Network error. Check your connection and try again.",
      );

      if (failure) {
        setDialogError(failure);
        return;
      }

      if (action === "delete") setDialog(null);
      setMessage(ACTION_DONE[action]);
      await loadAssetsRef.current();
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setFilters((current) => ({ ...EMPTY_FILTERS, showArchived: current.showArchived }));
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-kicker uppercase text-ink-3">Fleet</div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Assets</h1>
              <p className="m-0 text-sm text-ink-3">
                Track trailers, containers, pallets, plant, machinery and equipment.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {showSkeleton ? null : (
                <Badge tone="neutral">
                  {activeCount} asset{activeCount === 1 ? "" : "s"}
                </Badge>
              )}
              {canWrite ? <Button onClick={() => openDialog(null, "edit")}>Add asset</Button> : null}
            </div>
          </header>

          <MessageBanner tone="danger">{typeError}</MessageBanner>

          <MessageBanner tone="success">{message}</MessageBanner>

          <div className="mb-3 flex flex-wrap items-end gap-3">
            <SearchInput
              id="asset-search"
              label="Search assets"
              value={filters.query}
              onChange={(query) => setFilters((current) => ({ ...current, query }))}
              placeholder="Search name, number, registration, serial or barcode"
              resultHint={
                filtering
                  ? `${visibleAssets.length} of ${filters.showArchived ? assets.length : activeCount}`
                  : undefined
              }
              wrapperClassName="mb-0 min-w-[260px] flex-1"
            />

            <Select
              id="asset-filter-type"
              label="Type"
              value={filters.typeId}
              onChange={(event) =>
                setFilters((current) => ({ ...current, typeId: event.target.value }))
              }
            >
              <option value="">Any type</option>
              {assetTypes.map((assetType) => (
                <option key={assetType.id} value={assetType.id}>
                  {assetType.name}
                </option>
              ))}
            </Select>

            <Select
              id="asset-filter-status"
              label="Status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as StatusFilter,
                }))
              }
            >
              <option value="any">Any status</option>
              {ASSET_STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>

            <Select
              id="asset-filter-mechanical"
              label="Mechanical"
              value={filters.mechanical}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  mechanical: event.target.value as MechanicalFilter,
                }))
              }
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>

            {archiveSupported === true ? (
              <label className="flex h-10 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={filters.showArchived}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, showArchived: event.target.checked }))
                  }
                />
                Show archived
              </label>
            ) : null}

            {filtering ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          <DataTable
            columns={COLUMNS}
            rows={visibleAssets}
            rowKey={(asset) => asset.id}
            state={tableState}
            skeletonRows={6}
            onRowClick={(asset) => openDialog(asset.id, "view")}
            sort={sort}
            onSortChange={(key) => setSort((current) => nextSort(current, key as SortKey))}
            errorMessage={loadError || undefined}
            onRetry={() => void loadAssets()}
            emptyTitle={
              assets.length === 0
                ? "No assets yet"
                : allArchivedHidden
                  ? "All assets are archived"
                  : "No assets match these filters"
            }
            emptyDescription={
              assets.length === 0
                ? "Add trailers, containers, pallets and equipment to start the register."
                : undefined
            }
            emptyAction={
              allArchivedHidden ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilters((current) => ({ ...current, showArchived: true }))}
                >
                  Show archived
                </Button>
              ) : assets.length > 0 && filtering ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />

          {dialog && !(dialog.assetId && !dialogAsset) ? (
            <AssetDialog
              key={dialog.key}
              asset={dialogAsset}
              initialMode={dialog.mode}
              assetTypes={assetTypes}
              canWrite={canWrite}
              canDelete={canDelete}
              archiveSupported={archiveSupported === true}
              busy={busy}
              error={dialogError}
              onClose={closeDialog}
              onSave={(values) => void handleSave(values)}
              onArchive={() => void handleAction("archive")}
              onRestore={() => void handleAction("restore")}
              onDelete={() => void handleAction("delete")}
            />
          ) : null}
        </main>
      </div>
    </TenantGate>
  );
}
