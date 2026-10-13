/* Form values to the row written to `assets`. Moved out of app/assets/page.tsx
   unchanged in behaviour so it can be tested. Client-safe. */

import type { AssetFormValues, AssetType } from "./types";

export type AssetPayload = {
  name: string;
  asset_number: string;
  identifier_type: string;
  asset_type_id: string;
  asset_type: string;
  reference: string | null;
  registration: string | null;
  serial_number: string | null;
  barcode: string | null;
  mechanical: boolean;
  status: string;
  notes: string | null;
};

export type AssetFormCheck = { ok: true; type: AssetType } | { ok: false; error: string };

export function validateAssetForm(
  values: AssetFormValues,
  assetTypes: readonly AssetType[],
): AssetFormCheck {
  if (!values.name.trim()) return { ok: false, error: "Asset name is required." };
  if (!values.assetNumber.trim()) return { ok: false, error: "Asset number is required." };
  if (!values.assetTypeId) return { ok: false, error: "Select an asset type." };

  const type = assetTypes.find((candidate) => candidate.id === values.assetTypeId);
  if (!type) return { ok: false, error: "The selected asset type is invalid." };

  return { ok: true, type };
}

/* Identifier kinds whose number doubles as the free-text reference. */
const REFERENCE_IDENTIFIERS = new Set([
  "internal",
  "trailer_number",
  "container_number",
  "pallet_number",
]);

export function buildAssetPayload(values: AssetFormValues, type: AssetType): AssetPayload {
  const assetNumber = values.assetNumber.trim();
  const serial = values.serialNumber.trim();
  const barcode = values.barcode.trim();

  return {
    name: values.name.trim(),
    asset_number: assetNumber,
    identifier_type: values.identifierType,
    asset_type_id: type.id,
    asset_type: type.name,
    reference: REFERENCE_IDENTIFIERS.has(values.identifierType) ? assetNumber : null,
    registration: values.identifierType === "vrm" ? assetNumber.toUpperCase() : null,
    serial_number:
      values.identifierType === "serial_number" && !serial ? assetNumber : serial || null,
    barcode: values.identifierType === "barcode" && !barcode ? assetNumber : barcode || null,
    mechanical: values.mechanical,
    status: values.status,
    notes: values.notes.trim() || null,
  };
}
