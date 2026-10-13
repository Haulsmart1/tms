/* Shapes shared by the /assets page, its dialog and the pure rules in
   lib/assets/. Client-safe: no server imports. */

export type AssetType = {
  id: string;
  name: string;
};

export type Asset = {
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
  /* Absent (undefined) when docs/sql/assets_01 is not applied: the page then
     loads without these columns and hides the archive controls. */
  archived_at?: string | null;
  archived_by?: string | null;
};

export const IDENTIFIER_TYPES = [
  ["internal", "Internal Asset Number"],
  ["vrm", "VRM / Registration"],
  ["trailer_number", "Trailer Number"],
  ["container_number", "Container Number"],
  ["pallet_number", "Pallet Number"],
  ["barcode", "Barcode"],
  ["serial_number", "Serial Number"],
] as const;

export const ASSET_STATUSES = [
  ["active", "Active"],
  ["maintenance", "Maintenance"],
  ["inactive", "Inactive"],
] as const;

export type AssetFormValues = {
  name: string;
  assetNumber: string;
  identifierType: string;
  assetTypeId: string;
  serialNumber: string;
  barcode: string;
  mechanical: boolean;
  status: string;
  notes: string;
};

export const EMPTY_ASSET_FORM: AssetFormValues = {
  name: "",
  assetNumber: "",
  identifierType: "internal",
  assetTypeId: "",
  serialNumber: "",
  barcode: "",
  mechanical: false,
  status: "active",
  notes: "",
};

export function formFromAsset(asset: Asset): AssetFormValues {
  return {
    name: asset.name ?? "",
    assetNumber: asset.asset_number ?? "",
    identifierType: asset.identifier_type ?? "internal",
    assetTypeId: asset.asset_type_id ?? "",
    serialNumber: asset.serial_number ?? "",
    barcode: asset.barcode ?? "",
    mechanical: Boolean(asset.mechanical),
    status: asset.status ?? "active",
    notes: asset.notes ?? "",
  };
}

const DEFAULT_MECHANICAL_TYPES = new Set([
  "Trailer",
  "Forklift",
  "Fridge Unit",
  "Generator",
  "Plant / Machinery",
]);

/** Picking one of these types ticks "Mechanical" for you; the user can untick it. */
export function defaultMechanical(typeName: string): boolean {
  return DEFAULT_MECHANICAL_TYPES.has(typeName);
}

export function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
