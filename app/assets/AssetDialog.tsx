"use client";

import { type FormEvent, useState } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import Textarea from "../../components/Textarea";
import { isArchived } from "../../lib/assets/register";
import {
  ASSET_STATUSES,
  EMPTY_ASSET_FORM,
  IDENTIFIER_TYPES,
  defaultMechanical,
  formFromAsset,
  formatLabel,
  type Asset,
  type AssetFormValues,
  type AssetType,
} from "../../lib/assets/types";
import StatusBadge from "./StatusBadge";

const FORM_ID = "asset-form";

type Props = {
  /** null when adding a new asset. */
  asset: Asset | null;
  initialMode: "view" | "edit";
  assetTypes: AssetType[];
  canWrite: boolean;
  canDelete: boolean;
  archiveSupported: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: AssetFormValues) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

/* The page mounts this with a fresh `key` per open, so the form and the
   delete confirmation start clean every time without a reset effect. The
   server decides every action; the props here only hide buttons that would
   certainly be refused. */
export default function AssetDialog({
  asset,
  initialMode,
  assetTypes,
  canWrite,
  canDelete,
  archiveSupported,
  busy,
  error,
  onClose,
  onSave,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const [mode, setMode] = useState<"view" | "edit">(asset ? initialMode : "edit");
  const [values, setValues] = useState<AssetFormValues>(
    asset ? formFromAsset(asset) : EMPTY_ASSET_FORM,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const archived = asset ? isArchived(asset) : false;
  const confirmWord = asset ? asset.asset_number || asset.name : "";
  const title = !asset ? "Add asset" : mode === "edit" ? `Edit ${asset.name}` : asset.name;

  function set<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function changeType(assetTypeId: string) {
    const type = assetTypes.find((candidate) => candidate.id === assetTypeId);
    setValues((current) => ({
      ...current,
      assetTypeId,
      mechanical: type ? defaultMechanical(type.name) : current.mechanical,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onSave(values);
  }

  function cancelEdit() {
    if (!asset) {
      onClose();
      return;
    }
    setValues(formFromAsset(asset));
    setMode("view");
  }

  function cancelDelete() {
    setConfirmingDelete(false);
    setConfirmText("");
  }

  const footer =
    mode === "edit" ? (
      <>
        <Button variant="secondary" disabled={busy} onClick={cancelEdit}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID} disabled={busy}>
          {busy ? "Saving..." : asset ? "Save changes" : "Add asset"}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close
        </Button>
        {canWrite && archiveSupported ? (
          archived ? (
            <Button variant="secondary" disabled={busy} onClick={onRestore}>
              Restore
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={onArchive}>
              Archive
            </Button>
          )
        ) : null}
        {canDelete && !confirmingDelete ? (
          <Button variant="danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        ) : null}
        {canWrite ? (
          <Button
            disabled={busy || archived}
            onClick={() => {
              cancelDelete();
              setMode("edit");
            }}
          >
            Edit
          </Button>
        ) : null}
      </>
    );

  return (
    <Modal open onClose={onClose} title={title} size="lg" footer={footer}>
      <MessageBanner tone="danger">{error}</MessageBanner>

      {mode === "view" && asset ? (
        <div className="grid gap-4">
          <AssetDetails asset={asset} />

          {archived && canWrite ? (
            <p className="m-0 text-sm text-ink-2">
              This asset is archived. Restore it to edit it.
            </p>
          ) : null}

          {confirmingDelete ? (
            <div className="grid gap-3 rounded-lg border-2 border-danger bg-danger-tint p-4">
              <p className="m-0 text-sm text-ink">
                Permanently delete this asset? This cannot be undone. Assets with maintenance
                history cannot be deleted; archive them instead.
              </p>
              <Field
                id="asset-delete-confirm"
                label={`Type ${confirmWord} to confirm`}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoComplete="off"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy || confirmText.trim() !== confirmWord}
                  onClick={onDelete}
                >
                  Delete permanently
                </Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={cancelDelete}>
                  Keep asset
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field
            id="asset-name"
            label="Asset Name"
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="e.g. Curtainsider Trailer 12"
            required
          />

          <Field
            id="asset-number"
            label="Asset Number"
            value={values.assetNumber}
            onChange={(event) => set("assetNumber", event.target.value)}
            placeholder="e.g. TRL-012"
            required
          />

          <Select
            id="asset-identifier-type"
            label="Identifier Type"
            value={values.identifierType}
            onChange={(event) => set("identifierType", event.target.value)}
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
            value={values.assetTypeId}
            onChange={(event) => changeType(event.target.value)}
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
            value={values.serialNumber}
            onChange={(event) => set("serialNumber", event.target.value)}
            placeholder="Optional serial number"
          />

          <Field
            id="asset-barcode"
            label="Barcode"
            value={values.barcode}
            onChange={(event) => set("barcode", event.target.value)}
            placeholder="Scan or enter barcode"
          />

          <Select
            id="asset-status"
            label="Status"
            value={values.status}
            onChange={(event) => set("status", event.target.value)}
          >
            {ASSET_STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
            <input
              type="checkbox"
              checked={values.mechanical}
              onChange={(event) => set("mechanical", event.target.checked)}
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
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Asset notes..."
            rows={4}
            className="resize-y"
          />
        </form>
      )}
    </Modal>
  );
}

function AssetDetails({ asset }: { asset: Asset }) {
  const rows: Array<[string, string]> = [
    ["Asset number", asset.asset_number || "Not set"],
    ["Type", asset.asset_type || "Not set"],
    ["Identifier type", formatLabel(asset.identifier_type || "internal")],
    ["Registration", asset.registration || "Not set"],
    ["Serial number", asset.serial_number || "Not set"],
    ["Barcode", asset.barcode || "Not set"],
    ["Mechanical", asset.mechanical ? "Yes, can be linked to maintenance records" : "No"],
  ];

  return (
    <div className="grid gap-4">
      <StatusBadge asset={asset} />

      <dl className="m-0 grid grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="mb-0.5 text-kicker uppercase text-ink-3">{label}</dt>
            <dd className="m-0 break-words text-sm font-semibold text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>

      {asset.notes ? (
        <div className="break-words rounded-md border border-line bg-surface-2 p-3 text-sm leading-relaxed text-ink-2">
          {asset.notes}
        </div>
      ) : null}
    </div>
  );
}
