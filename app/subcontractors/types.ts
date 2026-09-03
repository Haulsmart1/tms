/* Moved verbatim out of page.tsx so the card and the compliance helpers can
   share them without importing the page. */
export type Subcontractor = {
  id: string;
  tenant_id: string;
  name: string;
  subcontractor_type: "owner_driver" | "fleet" | null;
  legal_name: string | null;
  trading_name: string | null;
  company_number: string | null;
  vat_number: string | null;
  operator_licence_number: string | null;
  goods_in_transit_insurer: string | null;
  goods_in_transit_policy_number: string | null;
  goods_in_transit_expiry: string | null;
  public_liability_insurer: string | null;
  public_liability_policy_number: string | null;
  public_liability_expiry: string | null;
  employers_liability_insurer: string | null;
  employers_liability_policy_number: string | null;
  employers_liability_expiry: string | null;
  motor_insurance_insurer: string | null;
  motor_insurance_policy_number: string | null;
  motor_insurance_expiry: string | null;
  adr_capable: boolean;
  waste_carrier_licence: string | null;
  waste_carrier_expiry: string | null;
  payment_terms_days: number | null;
  default_rate: number | null;
  rate_type: string | null;
  fuel_surcharge_percent: number | null;
  waiting_time_rate_per_hour: number | null;
  cancellation_charge: number | null;
  accounts_email: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  location: string | null;
  notes: string | null;
  active: boolean;
};

export type Employee = {
  id: string;
  subcontractor_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  employment_type: string | null;
  directly_employed: boolean;
  employment_start_date: string | null;
  employment_end_date: string | null;
  active: boolean;
  owner: boolean;
  notes: string | null;
};

export type SubcontractorVehicle = {
  id: string;
  subcontractor_id: string;
  registration: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean;
  mot_expiry: string | null;
  tax_expiry: string | null;
  insurance_expiry: string | null;
  vor: boolean;
  notes: string | null;
};

export type ComplianceLevel = "ok" | "amber" | "red";

export type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};
