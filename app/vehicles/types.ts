/* Moved verbatim out of page.tsx so the card and the compliance helpers can
   share them without importing the page. */
export type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  created_at?: string;
  mot_expiry: string | null;
  tax_expiry: string | null;
  insurance_type: "individual" | "fleet" | null;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_start_date: string | null;
  insurance_expiry: string | null;
  fleet_insurance_policy_id: string | null;
};

export type FleetInsurancePolicy = {
  id: string;
  tenant_id: string;
  provider: string;
  policy_number: string;
  start_date: string | null;
  expiry_date: string;
  auto_renew: boolean;
  renewal_notice_days: number;
  active: boolean;
  notes: string | null;
};
