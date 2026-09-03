"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import SubcontractorCard from "./SubcontractorCard";
import InfoField from "../../components/InfoField";
import { getCompliance, mostUrgent } from "../../lib/compliance/expiry";
import { StatusBadge, subcontractorCardStyle } from "./compliance";
import type {
  Employee,
  Subcontractor,
  SubcontractorVehicle,
} from "./types";

/* Six, because the grid is md:grid-cols-2 xl:grid-cols-3, so six fills whole
   rows at every breakpoint instead of leaving a ragged last row. The count is
   a guess about data that has not arrived; the grid will reflow on arrival.
   Recorded in the spec rather than papered over. */
const SKELETON_CARDS = 6;

const PLACEHOLDER_SUBCONTRACTOR = {
  id: "",
  name: "",
  subcontractor_type: "fleet",
  contact_name: null,
  email: null,
  phone: null,
  operator_licence_number: null,
  payment_terms_days: null,
} as Subcontractor;

const EMPTY_FORM = {
  name: "",
  subcontractor_type: "fleet" as "owner_driver" | "fleet",
  legal_name: "",
  trading_name: "",
  company_number: "",
  vat_number: "",
  operator_licence_number: "",
  goods_in_transit_insurer: "",
  goods_in_transit_policy_number: "",
  goods_in_transit_expiry: "",
  public_liability_insurer: "",
  public_liability_policy_number: "",
  public_liability_expiry: "",
  employers_liability_insurer: "",
  employers_liability_policy_number: "",
  employers_liability_expiry: "",
  motor_insurance_insurer: "",
  motor_insurance_policy_number: "",
  motor_insurance_expiry: "",
  adr_capable: false,
  waste_carrier_licence: "",
  waste_carrier_expiry: "",
  payment_terms_days: "30",
  default_rate: "",
  rate_type: "",
  fuel_surcharge_percent: "",
  waiting_time_rate_per_hour: "",
  cancellation_charge: "",
  accounts_email: "",
  contact_name: "",
  phone: "",
  email: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  address: "",
  location: "",
  notes: "",
  active: true,
};

const EMPTY_EMPLOYEE_FORM = {
  full_name: "",
  email: "",
  phone: "",
  job_title: "",
  employment_type: "employee",
  directly_employed: true,
  employment_start_date: "",
  employment_end_date: "",
  active: true,
  owner: false,
  notes: "",
};

const EMPTY_VEHICLE_FORM = {
  registration: "",
  vehicle_type: "",
  make: "",
  model: "",
  mot_expiry: "",
  tax_expiry: "",
  insurance_expiry: "",
  vor: false,
  active: true,
  notes: "",
};

export default function SubcontractorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";

  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vehicles, setVehicles] = useState<SubcontractorVehicle[]>([]);
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [employeeForm, setEmployeeForm] = useState(EMPTY_EMPLOYEE_FORM);
  const [vehicleForm, setVehicleForm] = useState(EMPTY_VEHICLE_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const [vehicleSaving, setVehicleSaving] = useState(false);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: subcontractors.length > 0,
  });

  const showEmpty = !showSkeleton && subcontractors.length === 0;

  const selectedSubcontractor = subcontractors.find(
    (item) => item.id === selectedSubcontractorId
  ) ?? null;

  const loadData = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoading(true);
    setMessage("");

    const [subsResult, employeeResult, vehicleResult] = await Promise.all([
      tenant
        .filterByTenant(supabase.from("subcontractors").select("*"))
        .order("name", { ascending: true }),
      tenant
        .filterByTenant(supabase.from("subcontractor_employees").select("*"))
        .order("full_name", { ascending: true }),
      tenant
        .filterByTenant(supabase.from("subcontractor_vehicles").select("*"))
        .order("registration", { ascending: true }),
    ]);

    if (subsResult.error) {
      setMessage(subsResult.error.message);
      setSubcontractors([]);
    } else {
      const rows = (subsResult.data as Subcontractor[]) || [];
      setSubcontractors(rows);
      if (!selectedSubcontractorId && rows.length > 0) {
        setSelectedSubcontractorId(rows[0].id);
      }
    }

    if (employeeResult.error) {
      setMessage((current) =>
        current ? `${current} | ${employeeResult.error.message}` : employeeResult.error.message
      );
      setEmployees([]);
    } else {
      setEmployees((employeeResult.data as Employee[]) || []);
    }

    if (vehicleResult.error) {
      setMessage((current) =>
        current ? `${current} | ${vehicleResult.error.message}` : vehicleResult.error.message
      );
      setVehicles([]);
    } else {
      setVehicles((vehicleResult.data as SubcontractorVehicle[]) || []);
    }

    setLoading(false);
  }, [selectedSubcontractorId, supabase, tenant]);

  useEffect(() => {
    void loadData();
  }, [loadData, tenant.status, tenant.activeTenantId]);

  function resetSubcontractorForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function resetEmployeeForm() {
    setEditingEmployeeId(null);
    setEmployeeForm(EMPTY_EMPLOYEE_FORM);
  }

  function resetVehicleForm() {
    setEditingVehicleId(null);
    setVehicleForm(EMPTY_VEHICLE_FORM);
  }

  function startEdit(subcontractor: Subcontractor) {
    setEditingId(subcontractor.id);
    setSelectedSubcontractorId(subcontractor.id);
    setForm({
      name: subcontractor.name || "",
      subcontractor_type:
        subcontractor.subcontractor_type === "owner_driver" ? "owner_driver" : "fleet",
      legal_name: subcontractor.legal_name || "",
      trading_name: subcontractor.trading_name || "",
      company_number: subcontractor.company_number || "",
      vat_number: subcontractor.vat_number || "",
      operator_licence_number: subcontractor.operator_licence_number || "",
      goods_in_transit_insurer: subcontractor.goods_in_transit_insurer || "",
      goods_in_transit_policy_number:
        subcontractor.goods_in_transit_policy_number || "",
      goods_in_transit_expiry: subcontractor.goods_in_transit_expiry || "",
      public_liability_insurer: subcontractor.public_liability_insurer || "",
      public_liability_policy_number:
        subcontractor.public_liability_policy_number || "",
      public_liability_expiry: subcontractor.public_liability_expiry || "",
      employers_liability_insurer:
        subcontractor.employers_liability_insurer || "",
      employers_liability_policy_number:
        subcontractor.employers_liability_policy_number || "",
      employers_liability_expiry:
        subcontractor.employers_liability_expiry || "",
      motor_insurance_insurer: subcontractor.motor_insurance_insurer || "",
      motor_insurance_policy_number:
        subcontractor.motor_insurance_policy_number || "",
      motor_insurance_expiry: subcontractor.motor_insurance_expiry || "",
      adr_capable: subcontractor.adr_capable || false,
      waste_carrier_licence: subcontractor.waste_carrier_licence || "",
      waste_carrier_expiry: subcontractor.waste_carrier_expiry || "",
      payment_terms_days: String(subcontractor.payment_terms_days ?? 30),
      default_rate:
        subcontractor.default_rate === null ? "" : String(subcontractor.default_rate),
      rate_type: subcontractor.rate_type || "",
      fuel_surcharge_percent:
        subcontractor.fuel_surcharge_percent === null
          ? ""
          : String(subcontractor.fuel_surcharge_percent),
      waiting_time_rate_per_hour:
        subcontractor.waiting_time_rate_per_hour === null
          ? ""
          : String(subcontractor.waiting_time_rate_per_hour),
      cancellation_charge:
        subcontractor.cancellation_charge === null
          ? ""
          : String(subcontractor.cancellation_charge),
      accounts_email: subcontractor.accounts_email || "",
      contact_name: subcontractor.contact_name || "",
      phone: subcontractor.phone || "",
      email: subcontractor.email || "",
      emergency_contact_name: subcontractor.emergency_contact_name || "",
      emergency_contact_phone: subcontractor.emergency_contact_phone || "",
      address: subcontractor.address || "",
      location: subcontractor.location || "",
      notes: subcontractor.notes || "",
      active: subcontractor.active ?? true,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEditEmployee(employee: Employee) {
    setEditingEmployeeId(employee.id);
    setEmployeeForm({
      full_name: employee.full_name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      job_title: employee.job_title || "",
      employment_type: employee.employment_type || "employee",
      directly_employed: employee.directly_employed,
      employment_start_date: employee.employment_start_date || "",
      employment_end_date: employee.employment_end_date || "",
      active: employee.active,
      owner: employee.owner,
      notes: employee.notes || "",
    });
  }

  function startEditVehicle(vehicle: SubcontractorVehicle) {
    setEditingVehicleId(vehicle.id);
    setVehicleForm({
      registration: vehicle.registration || "",
      vehicle_type: vehicle.vehicle_type || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      mot_expiry: vehicle.mot_expiry || "",
      tax_expiry: vehicle.tax_expiry || "",
      insurance_expiry: vehicle.insurance_expiry || "",
      vor: vehicle.vor,
      active: vehicle.active,
      notes: vehicle.notes || "",
    });
  }

  async function saveSubcontractor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isAdmin) {
      setMessage("Only an admin can manage subcontractors.");
      return;
    }

    if (!form.name.trim()) {
      setMessage("Subcontractor name is required.");
      return;
    }

    if (tenant.status !== "ready") {
      setMessage("Still loading. Try again in a moment.");
      return;
    }

    if (!editingId && !tenant.writeTenantId) {
      setMessage("Pick a specific tenant before creating a subcontractor.");
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      subcontractor_type: form.subcontractor_type,
      legal_name: form.legal_name.trim() || null,
      trading_name: form.trading_name.trim() || null,
      company_number: form.company_number.trim() || null,
      vat_number: form.vat_number.trim() || null,
      operator_licence_number: form.operator_licence_number.trim() || null,
      goods_in_transit_insurer: form.goods_in_transit_insurer.trim() || null,
      goods_in_transit_policy_number:
        form.goods_in_transit_policy_number.trim() || null,
      goods_in_transit_expiry: form.goods_in_transit_expiry || null,
      public_liability_insurer: form.public_liability_insurer.trim() || null,
      public_liability_policy_number:
        form.public_liability_policy_number.trim() || null,
      public_liability_expiry: form.public_liability_expiry || null,
      employers_liability_insurer:
        form.employers_liability_insurer.trim() || null,
      employers_liability_policy_number:
        form.employers_liability_policy_number.trim() || null,
      employers_liability_expiry: form.employers_liability_expiry || null,
      motor_insurance_insurer: form.motor_insurance_insurer.trim() || null,
      motor_insurance_policy_number:
        form.motor_insurance_policy_number.trim() || null,
      motor_insurance_expiry: form.motor_insurance_expiry || null,
      adr_capable: form.adr_capable,
      waste_carrier_licence: form.waste_carrier_licence.trim() || null,
      waste_carrier_expiry: form.waste_carrier_expiry || null,
      payment_terms_days: Number(form.payment_terms_days || 30),
      default_rate: form.default_rate ? Number(form.default_rate) : null,
      rate_type: form.rate_type.trim() || null,
      fuel_surcharge_percent: form.fuel_surcharge_percent
        ? Number(form.fuel_surcharge_percent)
        : null,
      waiting_time_rate_per_hour: form.waiting_time_rate_per_hour
        ? Number(form.waiting_time_rate_per_hour)
        : null,
      cancellation_charge: form.cancellation_charge
        ? Number(form.cancellation_charge)
        : null,
      accounts_email: form.accounts_email.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      address: form.address.trim() || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      active: form.active,
      updated_at: new Date().toISOString(),
    };

    let error: { message?: string } | null = null;

    if (editingId) {
      const result = await tenant.filterByTenant(
        supabase.from("subcontractors").update(payload).eq("id", editingId)
      );
      error = result.error;
    } else {
      const result = await supabase.from("subcontractors").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
        },
      ]);
      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save subcontractor.");
      setSaving(false);
      return;
    }

    setMessage(editingId ? "Subcontractor updated." : "Subcontractor created.");
    resetSubcontractorForm();
    await loadData();
    setSaving(false);
  }

  async function saveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!selectedSubcontractorId) {
      setMessage("Select a subcontractor first.");
      return;
    }

    if (!employeeForm.full_name.trim()) {
      setMessage("Employee name is required.");
      return;
    }

    if (tenant.status !== "ready") {
      setMessage("Still loading. Try again in a moment.");
      return;
    }

    if (!tenant.writeTenantId) {
      setMessage("Pick a specific tenant before creating an employee.");
      return;
    }

    setEmployeeSaving(true);

    const payload = {
      subcontractor_id: selectedSubcontractorId,
      full_name: employeeForm.full_name.trim(),
      email: employeeForm.email.trim() || null,
      phone: employeeForm.phone.trim() || null,
      job_title: employeeForm.job_title.trim() || null,
      employment_type: employeeForm.employment_type.trim() || "employee",
      directly_employed: employeeForm.directly_employed,
      employment_start_date: employeeForm.employment_start_date || null,
      employment_end_date: employeeForm.employment_end_date || null,
      active: employeeForm.active,
      owner: employeeForm.owner,
      notes: employeeForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error: { message?: string } | null = null;

    if (editingEmployeeId) {
      const result = await tenant.filterByTenant(
        supabase
          .from("subcontractor_employees")
          .update(payload)
          .eq("id", editingEmployeeId)
      );
      error = result.error;
    } else {
      const result = await supabase.from("subcontractor_employees").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
        },
      ]);
      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save employee.");
      setEmployeeSaving(false);
      return;
    }

    setMessage(editingEmployeeId ? "Employee updated." : "Employee created.");
    resetEmployeeForm();
    await loadData();
    setEmployeeSaving(false);
  }

  async function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!selectedSubcontractorId) {
      setMessage("Select a subcontractor first.");
      return;
    }

    if (!vehicleForm.registration.trim()) {
      setMessage("Vehicle registration is required.");
      return;
    }

    if (tenant.status !== "ready") {
      setMessage("Still loading. Try again in a moment.");
      return;
    }

    if (!tenant.writeTenantId) {
      setMessage("Pick a specific tenant before creating a vehicle.");
      return;
    }

    setVehicleSaving(true);

    const payload = {
      subcontractor_id: selectedSubcontractorId,
      registration: vehicleForm.registration.trim().toUpperCase(),
      vehicle_type: vehicleForm.vehicle_type.trim() || null,
      make: vehicleForm.make.trim() || null,
      model: vehicleForm.model.trim() || null,
      mot_expiry: vehicleForm.mot_expiry || null,
      tax_expiry: vehicleForm.tax_expiry || null,
      insurance_expiry: vehicleForm.insurance_expiry || null,
      vor: vehicleForm.vor,
      active: vehicleForm.active,
      notes: vehicleForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error: { message?: string } | null = null;

    if (editingVehicleId) {
      const result = await tenant.filterByTenant(
        supabase
          .from("subcontractor_vehicles")
          .update(payload)
          .eq("id", editingVehicleId)
      );
      error = result.error;
    } else {
      const result = await supabase.from("subcontractor_vehicles").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
        },
      ]);
      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save vehicle.");
      setVehicleSaving(false);
      return;
    }

    setMessage(editingVehicleId ? "Vehicle updated." : "Vehicle created.");
    resetVehicleForm();
    await loadData();
    setVehicleSaving(false);
  }

  const selectedEmployees = employees.filter(
    (employee) => employee.subcontractor_id === selectedSubcontractorId
  );

  const selectedVehicles = vehicles.filter(
    (vehicle) => vehicle.subcontractor_id === selectedSubcontractorId
  );

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div>
              <div className="text-kicker uppercase text-ink-3">
                Carrier Network
              </div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Subcontractors
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Manage owner-drivers and fleet subcontractors, their compliance,
                employees, vehicles and commercial terms.
              </p>
            </div>
          </header>

          <MessageBanner tone="neutral">{message}</MessageBanner>

          {isAdmin ? (
            <form
              onSubmit={saveSubcontractor}
              className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-md font-semibold text-ink">
                  {editingId ? "Edit Subcontractor" : "Add Subcontractor"}
                </h2>

                {editingId ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={resetSubcontractorForm}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>

              <Section title="Company">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    label="Display Name"
                    value={form.name}
                    onChange={(value) => setForm({ ...form, name: value })}
                    required
                  />

                  <SelectField
                    label="Subcontractor Type"
                    value={form.subcontractor_type}
                    onChange={(value) =>
                      setForm({
                        ...form,
                        subcontractor_type: value as "owner_driver" | "fleet",
                      })
                    }
                    options={[
                      ["owner_driver", "Owner Driver"],
                      ["fleet", "Fleet Subcontractor"],
                    ]}
                  />

                  <TextField
                    label="Legal Name"
                    value={form.legal_name}
                    onChange={(value) => setForm({ ...form, legal_name: value })}
                  />

                  <TextField
                    label="Trading Name"
                    value={form.trading_name}
                    onChange={(value) => setForm({ ...form, trading_name: value })}
                  />

                  <TextField
                    label="Company Number"
                    value={form.company_number}
                    onChange={(value) => setForm({ ...form, company_number: value })}
                  />

                  <TextField
                    label="VAT Number"
                    value={form.vat_number}
                    onChange={(value) => setForm({ ...form, vat_number: value })}
                  />
                </div>
              </Section>

              <Section title="Contacts">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    label="Main Contact"
                    value={form.contact_name}
                    onChange={(value) => setForm({ ...form, contact_name: value })}
                  />
                  <TextField
                    label="Phone"
                    value={form.phone}
                    onChange={(value) => setForm({ ...form, phone: value })}
                  />
                  <TextField
                    label="Email"
                    value={form.email}
                    onChange={(value) => setForm({ ...form, email: value })}
                    type="email"
                  />
                  <TextField
                    label="Accounts Email"
                    value={form.accounts_email}
                    onChange={(value) => setForm({ ...form, accounts_email: value })}
                    type="email"
                  />
                  <TextField
                    label="Emergency Contact"
                    value={form.emergency_contact_name}
                    onChange={(value) =>
                      setForm({ ...form, emergency_contact_name: value })
                    }
                  />
                  <TextField
                    label="Emergency Phone"
                    value={form.emergency_contact_phone}
                    onChange={(value) =>
                      setForm({ ...form, emergency_contact_phone: value })
                    }
                  />
                </div>

                <TextareaField
                  label="Address"
                  value={form.address}
                  onChange={(value) => setForm({ ...form, address: value })}
                />
              </Section>

              <Section title="Compliance">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    label="Operator Licence"
                    value={form.operator_licence_number}
                    onChange={(value) =>
                      setForm({ ...form, operator_licence_number: value })
                    }
                  />
                  <TextField
                    label="Goods in Transit Insurer"
                    value={form.goods_in_transit_insurer}
                    onChange={(value) =>
                      setForm({ ...form, goods_in_transit_insurer: value })
                    }
                  />
                  <TextField
                    label="Goods in Transit Policy"
                    value={form.goods_in_transit_policy_number}
                    onChange={(value) =>
                      setForm({ ...form, goods_in_transit_policy_number: value })
                    }
                  />
                  <DateField
                    label="Goods in Transit Expiry"
                    value={form.goods_in_transit_expiry}
                    onChange={(value) =>
                      setForm({ ...form, goods_in_transit_expiry: value })
                    }
                  />

                  <TextField
                    label="Public Liability Insurer"
                    value={form.public_liability_insurer}
                    onChange={(value) =>
                      setForm({ ...form, public_liability_insurer: value })
                    }
                  />
                  <TextField
                    label="Public Liability Policy"
                    value={form.public_liability_policy_number}
                    onChange={(value) =>
                      setForm({ ...form, public_liability_policy_number: value })
                    }
                  />
                  <DateField
                    label="Public Liability Expiry"
                    value={form.public_liability_expiry}
                    onChange={(value) =>
                      setForm({ ...form, public_liability_expiry: value })
                    }
                  />

                  <TextField
                    label="Employers Liability Insurer"
                    value={form.employers_liability_insurer}
                    onChange={(value) =>
                      setForm({ ...form, employers_liability_insurer: value })
                    }
                  />
                  <TextField
                    label="Employers Liability Policy"
                    value={form.employers_liability_policy_number}
                    onChange={(value) =>
                      setForm({ ...form, employers_liability_policy_number: value })
                    }
                  />
                  <DateField
                    label="Employers Liability Expiry"
                    value={form.employers_liability_expiry}
                    onChange={(value) =>
                      setForm({ ...form, employers_liability_expiry: value })
                    }
                  />

                  <TextField
                    label="Motor Insurance Insurer"
                    value={form.motor_insurance_insurer}
                    onChange={(value) =>
                      setForm({ ...form, motor_insurance_insurer: value })
                    }
                  />
                  <TextField
                    label="Motor Insurance Policy"
                    value={form.motor_insurance_policy_number}
                    onChange={(value) =>
                      setForm({ ...form, motor_insurance_policy_number: value })
                    }
                  />
                  <DateField
                    label="Motor Insurance Expiry"
                    value={form.motor_insurance_expiry}
                    onChange={(value) =>
                      setForm({ ...form, motor_insurance_expiry: value })
                    }
                  />

                  <TextField
                    label="Waste Carrier Licence"
                    value={form.waste_carrier_licence}
                    onChange={(value) =>
                      setForm({ ...form, waste_carrier_licence: value })
                    }
                  />
                  <DateField
                    label="Waste Carrier Expiry"
                    value={form.waste_carrier_expiry}
                    onChange={(value) =>
                      setForm({ ...form, waste_carrier_expiry: value })
                    }
                  />
                </div>

                <CheckboxField
                  label="ADR capable"
                  checked={form.adr_capable}
                  onChange={(checked) => setForm({ ...form, adr_capable: checked })}
                />
              </Section>

              <Section title="Commercial">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    label="Payment Terms Days"
                    value={form.payment_terms_days}
                    onChange={(value) =>
                      setForm({ ...form, payment_terms_days: value })
                    }
                    type="number"
                  />
                  <TextField
                    label="Default Rate"
                    value={form.default_rate}
                    onChange={(value) => setForm({ ...form, default_rate: value })}
                    type="number"
                  />
                  <TextField
                    label="Rate Type"
                    value={form.rate_type}
                    onChange={(value) => setForm({ ...form, rate_type: value })}
                  />
                  <TextField
                    label="Fuel Surcharge %"
                    value={form.fuel_surcharge_percent}
                    onChange={(value) =>
                      setForm({ ...form, fuel_surcharge_percent: value })
                    }
                    type="number"
                  />
                  <TextField
                    label="Waiting Rate / Hour"
                    value={form.waiting_time_rate_per_hour}
                    onChange={(value) =>
                      setForm({ ...form, waiting_time_rate_per_hour: value })
                    }
                    type="number"
                  />
                  <TextField
                    label="Cancellation Charge"
                    value={form.cancellation_charge}
                    onChange={(value) =>
                      setForm({ ...form, cancellation_charge: value })
                    }
                    type="number"
                  />
                </div>
              </Section>

              <div className="mt-4 grid gap-3">
                <TextareaField
                  label="Notes"
                  value={form.notes}
                  onChange={(value) => setForm({ ...form, notes: value })}
                />

                <CheckboxField
                  label="Active"
                  checked={form.active}
                  onChange={(checked) => setForm({ ...form, active: checked })}
                />
              </div>

              <Button type="submit" disabled={saving} className="mt-4">
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Subcontractor"
                    : "Create Subcontractor"}
              </Button>
            </form>
          ) : null}

          <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-md font-semibold text-ink">
                  Subcontractor Accounts
                </h2>
                <p className="m-0 text-sm text-ink-3">
                  {subcontractors.length} subcontractor
                  {subcontractors.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {showEmpty ? (
              <p className="py-10 text-center text-sm text-ink-3">
                No subcontractors found.
              </p>
            ) : null}

            {/* ONE grid container shared by the skeleton and the real cards,
                deliberately: two containers would let these breakpoint classes
                drift apart and the layout jump on arrival. That is why this is
                a sibling conditional rather than a third arm of the chain. */}
            {showSkeleton || subcontractors.length > 0 ? (
              <div
                className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                aria-busy={showSkeleton}
              >
                {/* One announcement for the region, not one per bar. Replaces
                    what the old "Loading subcontractors..." text gave free. */}
                {showSkeleton ? (
                  <span className="sr-only" role="status">Loading subcontractors</span>
                ) : null}

                {showSkeleton
                  ? Array.from({ length: SKELETON_CARDS }, (_, index) => (
                      <SubcontractorCard
                        key={`skeleton-${index}`}
                        subcontractor={PLACEHOLDER_SUBCONTRACTOR}
                        loading
                        onEdit={() => {}}
                        onManage={() => {}}
                      />
                    ))
                  : subcontractors.map((subcontractor) => (
                      <SubcontractorCard
                        key={subcontractor.id}
                        subcontractor={subcontractor}
                        onEdit={(item) => {
                          setSelectedSubcontractorId(item.id);
                          startEdit(item);
                        }}
                        onManage={setSelectedSubcontractorId}
                      />
                    ))}
              </div>
            ) : null}
          </section>

          {selectedSubcontractor ? (
            <>
              <section className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-md font-semibold text-ink">
                      Employees · {selectedSubcontractor.name}
                    </h2>
                    <p className="m-0 text-sm text-ink-3">
                      Portal access should only be granted to active, directly
                      employed people.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={saveEmployee}
                  className="mb-3 mt-3 rounded-lg border border-line bg-surface-2 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <TextField
                      label="Full Name"
                      value={employeeForm.full_name}
                      onChange={(value) =>
                        setEmployeeForm({ ...employeeForm, full_name: value })
                      }
                      required
                    />
                    <TextField
                      label="Email"
                      value={employeeForm.email}
                      onChange={(value) =>
                        setEmployeeForm({ ...employeeForm, email: value })
                      }
                      type="email"
                    />
                    <TextField
                      label="Phone"
                      value={employeeForm.phone}
                      onChange={(value) =>
                        setEmployeeForm({ ...employeeForm, phone: value })
                      }
                    />
                    <TextField
                      label="Job Title"
                      value={employeeForm.job_title}
                      onChange={(value) =>
                        setEmployeeForm({ ...employeeForm, job_title: value })
                      }
                    />
                    <DateField
                      label="Employment Start"
                      value={employeeForm.employment_start_date}
                      onChange={(value) =>
                        setEmployeeForm({
                          ...employeeForm,
                          employment_start_date: value,
                        })
                      }
                    />
                    <DateField
                      label="Employment End"
                      value={employeeForm.employment_end_date}
                      onChange={(value) =>
                        setEmployeeForm({
                          ...employeeForm,
                          employment_end_date: value,
                        })
                      }
                    />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <CheckboxField
                      label="Directly employed"
                      checked={employeeForm.directly_employed}
                      onChange={(checked) =>
                        setEmployeeForm({
                          ...employeeForm,
                          directly_employed: checked,
                        })
                      }
                    />
                    <CheckboxField
                      label="Owner"
                      checked={employeeForm.owner}
                      onChange={(checked) =>
                        setEmployeeForm({ ...employeeForm, owner: checked })
                      }
                    />
                    <CheckboxField
                      label="Active"
                      checked={employeeForm.active}
                      onChange={(checked) =>
                        setEmployeeForm({ ...employeeForm, active: checked })
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="submit" disabled={employeeSaving}>
                      {employeeSaving
                        ? "Saving..."
                        : editingEmployeeId
                          ? "Update Employee"
                          : "Add Employee"}
                    </Button>

                    {editingEmployeeId ? (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={resetEmployeeForm}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </form>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {selectedEmployees.map((employee) => (
                    <article
                      key={employee.id}
                      className="rounded-lg border border-line bg-surface-2 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="m-0 text-md font-semibold text-ink">
                            {employee.full_name}
                          </h3>
                          <div className="text-sm text-ink-2">
                            {employee.job_title || "Employee"}
                          </div>
                        </div>

                        {employee.directly_employed && employee.active ? (
                          <Badge tone="success">Eligible</Badge>
                        ) : (
                          <Badge tone="danger">No Portal Access</Badge>
                        )}
                      </div>

                      <div className="my-2 grid grid-cols-2 gap-2">
                        <InfoField label="Email" value={employee.email} />
                        <InfoField label="Phone" value={employee.phone} />
                        <InfoField
                          label="Owner"
                          value={employee.owner ? "Yes" : "No"}
                        />
                        <InfoField
                          label="Directly Employed"
                          value={employee.directly_employed ? "Yes" : "No"}
                        />
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => startEditEmployee(employee)}
                      >
                        Edit Employee
                      </Button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-md font-semibold text-ink">
                      Vehicles · {selectedSubcontractor.name}
                    </h2>
                    <p className="m-0 text-sm text-ink-3">
                      Track MOT, tax, insurance and VOR status for subcontractor
                      vehicles.
                    </p>
                  </div>
                </div>

                <form
                  onSubmit={saveVehicle}
                  className="mb-3 mt-3 rounded-lg border border-line bg-surface-2 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <TextField
                      label="Registration"
                      value={vehicleForm.registration}
                      onChange={(value) =>
                        setVehicleForm({
                          ...vehicleForm,
                          registration: value.toUpperCase(),
                        })
                      }
                      required
                    />
                    <TextField
                      label="Vehicle Type"
                      value={vehicleForm.vehicle_type}
                      onChange={(value) =>
                        setVehicleForm({ ...vehicleForm, vehicle_type: value })
                      }
                    />
                    <TextField
                      label="Make"
                      value={vehicleForm.make}
                      onChange={(value) =>
                        setVehicleForm({ ...vehicleForm, make: value })
                      }
                    />
                    <TextField
                      label="Model"
                      value={vehicleForm.model}
                      onChange={(value) =>
                        setVehicleForm({ ...vehicleForm, model: value })
                      }
                    />
                    <DateField
                      label="MOT Expiry"
                      value={vehicleForm.mot_expiry}
                      onChange={(value) =>
                        setVehicleForm({ ...vehicleForm, mot_expiry: value })
                      }
                    />
                    <DateField
                      label="Tax Expiry"
                      value={vehicleForm.tax_expiry}
                      onChange={(value) =>
                        setVehicleForm({ ...vehicleForm, tax_expiry: value })
                      }
                    />
                    <DateField
                      label="Insurance Expiry"
                      value={vehicleForm.insurance_expiry}
                      onChange={(value) =>
                        setVehicleForm({
                          ...vehicleForm,
                          insurance_expiry: value,
                        })
                      }
                    />
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <CheckboxField
                      label="VOR"
                      checked={vehicleForm.vor}
                      onChange={(checked) =>
                        setVehicleForm({ ...vehicleForm, vor: checked })
                      }
                    />
                    <CheckboxField
                      label="Active"
                      checked={vehicleForm.active}
                      onChange={(checked) =>
                        setVehicleForm({ ...vehicleForm, active: checked })
                      }
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="submit" disabled={vehicleSaving}>
                      {vehicleSaving
                        ? "Saving..."
                        : editingVehicleId
                          ? "Update Vehicle"
                          : "Add Vehicle"}
                    </Button>

                    {editingVehicleId ? (
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={resetVehicleForm}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </form>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {selectedVehicles.map((vehicle) => {
                    const compliance = mostUrgent([
                      getCompliance(vehicle.mot_expiry),
                      getCompliance(vehicle.tax_expiry),
                      getCompliance(vehicle.insurance_expiry),
                    ]);

                    return (
                      <article
                        key={vehicle.id}
                        className={subcontractorCardStyle(compliance.level)}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h3 className="m-0 font-mono text-md font-semibold text-ink">
                              {vehicle.registration}
                            </h3>
                            <div className="text-sm text-ink-2">
                              {[vehicle.vehicle_type, vehicle.make, vehicle.model]
                                .filter(Boolean)
                                .join(" • ") || "Vehicle"}
                            </div>
                          </div>

                          <StatusBadge result={compliance} />
                        </div>

                        <div className="my-2 grid grid-cols-2 gap-2">
                          <InfoField
                            label="MOT"
                            value={
                              vehicle.mot_expiry
                                ? formatDate(vehicle.mot_expiry)
                                : "Not set"
                            }
                          />
                          <InfoField
                            label="Tax"
                            value={
                              vehicle.tax_expiry
                                ? formatDate(vehicle.tax_expiry)
                                : "Not set"
                            }
                          />
                          <InfoField
                            label="Insurance"
                            value={
                              vehicle.insurance_expiry
                                ? formatDate(vehicle.insurance_expiry)
                                : "Not set"
                            }
                          />
                          <InfoField
                            label="VOR"
                            value={vehicle.vor ? "Yes" : "No"}
                          />
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={() => startEditVehicle(vehicle)}
                        >
                          Edit Vehicle
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </TenantGate>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 border-t border-line pt-4">
      <h3 className="mb-3 text-kicker uppercase text-ink-3">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
      >
        {options.map(([valueOption, labelOption]) => (
          <option key={valueOption} value={valueOption}>
            {labelOption}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-md border border-ink-3 bg-surface px-3 text-sm text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}
