export type Vehicle = {
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
    vehicles?: Vehicle | null;
};
