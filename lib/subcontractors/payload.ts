/*
  Column allowlists and validation for subcontractor writes (finding M-4).

  The browser used to insert and update subcontractors, subcontractor_employees
  and subcontractor_vehicles directly, which meant the database had to leave
  those tables writable to every tenant member, drivers included. Every write
  now goes through app/api/subcontractors/**, and this module decides what a
  request body may set.

  Only the columns named below can ever reach the database. tenant_id,
  subcontractor_id, id and the timestamps are never read from the body: the
  route sets tenant_id from the authorized tenant and subcontractor_id from
  the URL after checking it belongs to that tenant.

  A key that is present is validated and written; a key that is absent is
  left alone, so an update never blanks a column the caller did not send.
*/

export type WriteMode = "create" | "update";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

type Row = Record<string, string | number | boolean | null>;

type FieldRule =
  | { kind: "required_text"; max: number; message: string; upper?: boolean }
  | { kind: "text"; max: number; fallback?: string }
  | { kind: "date" }
  | { kind: "number"; integer?: boolean; max: number }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] };

const SHORT = 500;
const LONG = 5000;
const MONEY_MAX = 1_000_000_000;

const SUBCONTRACTOR_FIELDS: Record<string, FieldRule> = {
  name: { kind: "required_text", max: SHORT, message: "Subcontractor name is required." },
  subcontractor_type: { kind: "enum", values: ["owner_driver", "fleet"] },
  legal_name: { kind: "text", max: SHORT },
  trading_name: { kind: "text", max: SHORT },
  company_number: { kind: "text", max: SHORT },
  vat_number: { kind: "text", max: SHORT },
  operator_licence_number: { kind: "text", max: SHORT },
  goods_in_transit_insurer: { kind: "text", max: SHORT },
  goods_in_transit_policy_number: { kind: "text", max: SHORT },
  goods_in_transit_expiry: { kind: "date" },
  public_liability_insurer: { kind: "text", max: SHORT },
  public_liability_policy_number: { kind: "text", max: SHORT },
  public_liability_expiry: { kind: "date" },
  employers_liability_insurer: { kind: "text", max: SHORT },
  employers_liability_policy_number: { kind: "text", max: SHORT },
  employers_liability_expiry: { kind: "date" },
  motor_insurance_insurer: { kind: "text", max: SHORT },
  motor_insurance_policy_number: { kind: "text", max: SHORT },
  motor_insurance_expiry: { kind: "date" },
  adr_capable: { kind: "boolean" },
  waste_carrier_licence: { kind: "text", max: SHORT },
  waste_carrier_expiry: { kind: "date" },
  payment_terms_days: { kind: "number", integer: true, max: 365 },
  default_rate: { kind: "number", max: MONEY_MAX },
  rate_type: { kind: "text", max: SHORT },
  fuel_surcharge_percent: { kind: "number", max: 1000 },
  waiting_time_rate_per_hour: { kind: "number", max: MONEY_MAX },
  cancellation_charge: { kind: "number", max: MONEY_MAX },
  accounts_email: { kind: "text", max: SHORT },
  contact_name: { kind: "text", max: SHORT },
  phone: { kind: "text", max: SHORT },
  email: { kind: "text", max: SHORT },
  emergency_contact_name: { kind: "text", max: SHORT },
  emergency_contact_phone: { kind: "text", max: SHORT },
  address: { kind: "text", max: LONG },
  location: { kind: "text", max: SHORT },
  notes: { kind: "text", max: LONG },
  active: { kind: "boolean" },
};

const EMPLOYEE_FIELDS: Record<string, FieldRule> = {
  full_name: { kind: "required_text", max: SHORT, message: "Employee name is required." },
  email: { kind: "text", max: SHORT },
  phone: { kind: "text", max: SHORT },
  job_title: { kind: "text", max: SHORT },
  employment_type: { kind: "text", max: SHORT, fallback: "employee" },
  directly_employed: { kind: "boolean" },
  employment_start_date: { kind: "date" },
  employment_end_date: { kind: "date" },
  active: { kind: "boolean" },
  owner: { kind: "boolean" },
  notes: { kind: "text", max: LONG },
};

const VEHICLE_FIELDS: Record<string, FieldRule> = {
  registration: {
    kind: "required_text",
    max: 32,
    message: "Vehicle registration is required.",
    upper: true,
  },
  vehicle_type: { kind: "text", max: SHORT },
  make: { kind: "text", max: SHORT },
  model: { kind: "text", max: SHORT },
  mot_expiry: { kind: "date" },
  tax_expiry: { kind: "date" },
  insurance_expiry: { kind: "date" },
  vor: { kind: "boolean" },
  active: { kind: "boolean" },
  notes: { kind: "text", max: LONG },
};

export const SUBCONTRACTOR_WRITE_COLUMNS = Object.freeze(Object.keys(SUBCONTRACTOR_FIELDS));
export const EMPLOYEE_WRITE_COLUMNS = Object.freeze(Object.keys(EMPLOYEE_FIELDS));
export const VEHICLE_WRITE_COLUMNS = Object.freeze(Object.keys(VEHICLE_FIELDS));

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function label(key: string): string {
  return key.replace(/_/g, " ");
}

type FieldResult = { ok: true; value: string | number | boolean | null } | { ok: false; message: string };

function parseField(key: string, rule: FieldRule, raw: unknown): FieldResult {
  switch (rule.kind) {
    case "required_text": {
      if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: rule.message };
      const value = rule.upper ? raw.trim().toUpperCase() : raw.trim();
      if (value.length > rule.max) return { ok: false, message: `The ${label(key)} is too long.` };
      return { ok: true, value };
    }
    case "text": {
      if (raw === null) return { ok: true, value: rule.fallback ?? null };
      if (typeof raw !== "string") return { ok: false, message: `The ${label(key)} must be text.` };
      const value = raw.trim();
      if (value.length > rule.max) return { ok: false, message: `The ${label(key)} is too long.` };
      return { ok: true, value: value || rule.fallback || null };
    }
    case "date": {
      if (raw === null || raw === "") return { ok: true, value: null };
      if (typeof raw !== "string" || !isCalendarDate(raw)) {
        return { ok: false, message: `The ${label(key)} must be a valid date.` };
      }
      return { ok: true, value: raw };
    }
    case "number": {
      if (raw === null || raw === "") return { ok: true, value: null };
      let value: number;
      if (typeof raw === "number") value = raw;
      else if (typeof raw === "string" && raw.trim() !== "") value = Number(raw.trim());
      else return { ok: false, message: `The ${label(key)} must be a number.` };
      if (!Number.isFinite(value) || value < 0 || value > rule.max || (rule.integer && !Number.isInteger(value))) {
        return { ok: false, message: `The ${label(key)} is not a valid amount.` };
      }
      return { ok: true, value };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { ok: false, message: `The ${label(key)} must be true or false.` };
      return { ok: true, value: raw };
    }
    case "enum": {
      if (typeof raw !== "string" || !rule.values.includes(raw)) {
        return { ok: false, message: `The ${label(key)} is not valid.` };
      }
      return { ok: true, value: raw };
    }
  }
}

function parseWith(fields: Record<string, FieldRule>, body: unknown, mode: WriteMode): ParseResult<Row> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const value: Row = {};

  for (const [key, rule] of Object.entries(fields)) {
    const present = Object.prototype.hasOwnProperty.call(input, key);
    if (!present) {
      if (mode === "create" && rule.kind === "required_text") return { ok: false, message: rule.message };
      continue;
    }
    const parsed = parseField(key, rule, input[key]);
    if (!parsed.ok) return parsed;
    value[key] = parsed.value;
  }

  if (Object.keys(value).length === 0) return { ok: false, message: "No valid fields supplied." };
  return { ok: true, value };
}

export function parseSubcontractorInput(body: unknown, mode: WriteMode): ParseResult<Row> {
  return parseWith(SUBCONTRACTOR_FIELDS, body, mode);
}

export function parseEmployeeInput(body: unknown, mode: WriteMode): ParseResult<Row> {
  return parseWith(EMPLOYEE_FIELDS, body, mode);
}

export function parseVehicleInput(body: unknown, mode: WriteMode): ParseResult<Row> {
  return parseWith(VEHICLE_FIELDS, body, mode);
}
