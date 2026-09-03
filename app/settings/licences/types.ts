/* Moved verbatim out of page.tsx so LicenceCard can share these without
   importing the page: the page imports the card, so a type imported the other
   way would be a circular edge. Siblings: app/vehicles/types.ts,
   app/subcontractors/types.ts, app/settings/users/types.ts.

   LicenceVehicle is NOT app/vehicles/types.ts's `Vehicle`, which is also
   exported. This one is the narrow `select` projection this page joins to a
   licence: `registration` is nullable here and non-null there, and none of the
   fleet compliance fields (mot_expiry, tax_expiry, insurance_*) are selected.
   Named apart so neither can be auto-imported in place of the other.

   Four-space indent, matching page.tsx rather than the rest of the app. */

export type LicenceVehicle = {
    id: string;
    tenant_id: string;
    registration: string | null;
    vehicle_type: string | null;
    make: string | null;
    model: string | null;
    active: boolean | null;
};

export type VehicleLicence = {
    id: string;
    tenant_id: string;
    vehicle_id: string;
    licence_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    active: boolean | null;
    notes: string | null;
    created_at: string;
    vehicles?: LicenceVehicle | null;
};
