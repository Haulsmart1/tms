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
};

/* Shape-only stand-in for the skeleton pass, mirroring PLACEHOLDER_CUSTOMER on
   /customers. AssetCard reads no field when `loading` is set, so the values
   here exist to satisfy the type, not to be rendered. */
export const PLACEHOLDER_ASSET: Asset = {
  id: "placeholder",
  company_id: "",
  tenant_id: "",
  name: "",
  asset_type: "",
  asset_type_id: null,
  asset_number: null,
  identifier_type: null,
  reference: null,
  serial_number: null,
  registration: null,
  barcode: null,
  mechanical: false,
  status: null,
  notes: null,
  created_at: null,
};
