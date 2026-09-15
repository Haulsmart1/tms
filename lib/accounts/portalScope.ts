/*
  Role-appropriate data for subcontractor records (review ACC-10, ACC-12, audit M3).

  Console side (/api/subcontractors): drivers get nothing; staff get the
  operational and compliance columns they need to dispatch; admins also get
  commercial terms, insurer policy numbers and company identifiers.

  Portal side (/api/subcontractor/me): every portal role sees its own
  subcontractor's compliance summary and its own employee record. Only a
  subcontractor_admin sees colleagues and portal users; drivers do not see job
  costs; accounts users do not see vehicles.
*/

type Tier = "super_admin" | "admin" | "staff";

export const SUBCONTRACTOR_STAFF_COLUMNS = [
  "id",
  "tenant_id",
  "name",
  "subcontractor_type",
  "trading_name",
  "operator_licence_number",
  "goods_in_transit_expiry",
  "public_liability_expiry",
  "employers_liability_expiry",
  "motor_insurance_expiry",
  "adr_capable",
  "waste_carrier_licence",
  "waste_carrier_expiry",
  "contact_name",
  "phone",
  "email",
  "emergency_contact_name",
  "emergency_contact_phone",
  "location",
  "active",
] as const;

export const SUBCONTRACTOR_ADMIN_EXTRA_COLUMNS = [
  "legal_name",
  "company_number",
  "vat_number",
  "goods_in_transit_insurer",
  "goods_in_transit_policy_number",
  "public_liability_insurer",
  "public_liability_policy_number",
  "employers_liability_insurer",
  "employers_liability_policy_number",
  "motor_insurance_insurer",
  "motor_insurance_policy_number",
  "payment_terms_days",
  "default_rate",
  "rate_type",
  "fuel_surcharge_percent",
  "waiting_time_rate_per_hour",
  "cancellation_charge",
  "accounts_email",
  "address",
  "notes",
] as const;

const CONSOLE_ROLES_WITHOUT_SUBCONTRACTOR_ACCESS = new Set(["driver"]);

/** The select list for a console caller, or null when the role must be refused. */
export function subcontractorColumnsFor(tier: Tier, roleName: string | null): string | null {
  if (tier === "staff" && CONSOLE_ROLES_WITHOUT_SUBCONTRACTOR_ACCESS.has(String(roleName ?? "").toLowerCase())) {
    return null;
  }
  const columns: string[] = [...SUBCONTRACTOR_STAFF_COLUMNS];
  if (tier !== "staff") columns.push(...SUBCONTRACTOR_ADMIN_EXTRA_COLUMNS);
  return columns.join(",");
}

export const PORTAL_SUBCONTRACTOR_COLUMNS =
  "id,name,subcontractor_type,contact_name,phone,email,operator_licence_number,goods_in_transit_expiry,public_liability_expiry,employers_liability_expiry,motor_insurance_expiry,adr_capable";

export const PORTAL_EMPLOYEE_COLUMNS =
  "id,subcontractor_id,full_name,email,phone,job_title,directly_employed,active,owner,employment_end_date";

export const PORTAL_VEHICLE_COLUMNS =
  "id,subcontractor_id,registration,vehicle_type,make,model,active,mot_expiry,tax_expiry,insurance_expiry,vor";

export const PORTAL_JOB_COLUMNS =
  "id,reference,customer_reference,external_reference,status,scheduled_date,job_date,priority,notes,vehicle_id,driver_id,pod_status,completed_at,created_at";

export type PortalScope = {
  jobs: boolean;
  jobCost: boolean;
  vehicles: boolean;
  employees: boolean;
  portalUsers: boolean;
};

export function portalScopeFor(role: string | null | undefined): PortalScope {
  switch (String(role ?? "").toLowerCase()) {
    case "subcontractor_admin":
      return { jobs: true, jobCost: true, vehicles: true, employees: true, portalUsers: true };
    case "dispatcher":
      return { jobs: true, jobCost: true, vehicles: true, employees: false, portalUsers: false };
    case "accounts":
      return { jobs: true, jobCost: true, vehicles: false, employees: false, portalUsers: false };
    case "driver":
      return { jobs: true, jobCost: false, vehicles: true, employees: false, portalUsers: false };
    default:
      return { jobs: false, jobCost: false, vehicles: false, employees: false, portalUsers: false };
  }
}

export type PortalLink = {
  id: string;
  subcontractor_id: string;
  created_at?: string | null;
};

/**
  A user may be linked to several subcontractors. The requested link wins when
  it is one of theirs; otherwise the oldest link is used. Returns null when a
  requested link is not theirs, so a guessed id never falls through to a default.
*/
export function pickPortalLink<T extends PortalLink>(links: readonly T[], requestedId: string | null): T | null {
  if (links.length === 0) return null;
  if (requestedId) return links.find((link) => link.id === requestedId) ?? null;
  return [...links].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0];
}
