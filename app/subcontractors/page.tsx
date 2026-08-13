"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";

type Subcontractor = {
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

type Employee = {
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

type SubcontractorVehicle = {
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

type ComplianceLevel = "ok" | "amber" | "red";

type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};

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

  const selectedSubcontractor = subcontractors.find(
    (item) => item.id === selectedSubcontractorId
  ) ?? null;

  const loadData = useCallback(async () => {
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
  }, [loadData, tenant.activeTenantId]);

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
      <main style={styles.page}>
        <div style={styles.container}>
          <header style={styles.header}>
            <div>
              <p style={styles.eyebrow}>Carrier Network</p>
              <h1 style={styles.title}>Subcontractors</h1>
              <p style={styles.subtitle}>
                Manage owner-drivers and fleet subcontractors, their compliance,
                employees, vehicles and commercial terms.
              </p>
            </div>
          </header>

          {message ? <div style={styles.message}>{message}</div> : null}

          {isAdmin ? (
            <form onSubmit={saveSubcontractor} style={styles.card}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>
                  {editingId ? "Edit Subcontractor" : "Add Subcontractor"}
                </h2>

                {editingId ? (
                  <button
                    type="button"
                    onClick={resetSubcontractorForm}
                    style={styles.secondaryButton}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>

              <Section title="Company">
                <div style={styles.grid}>
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
                <div style={styles.grid}>
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
                <div style={styles.grid}>
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
                <div style={styles.grid}>
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

              <button type="submit" style={styles.primaryButton} disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Subcontractor"
                    : "Create Subcontractor"}
              </button>
            </form>
          ) : null}

          <section style={styles.card}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Subcontractor Accounts</h2>
                <p style={styles.muted}>
                  {subcontractors.length} subcontractor
                  {subcontractors.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {loading ? (
              <div style={styles.empty}>Loading subcontractors...</div>
            ) : subcontractors.length === 0 ? (
              <div style={styles.empty}>No subcontractors found.</div>
            ) : (
              <div style={styles.subGrid}>
                {subcontractors.map((subcontractor) => {
                  const compliance = mostUrgent([
                    getCompliance(subcontractor.goods_in_transit_expiry),
                    getCompliance(subcontractor.public_liability_expiry),
                    getCompliance(subcontractor.employers_liability_expiry),
                    getCompliance(subcontractor.motor_insurance_expiry),
                    getCompliance(subcontractor.waste_carrier_expiry),
                  ]);

                  return (
                    <article
                      key={subcontractor.id}
                      style={subcontractorCardStyle(compliance.level)}
                    >
                      <div style={styles.subHeader}>
                        <div>
                          <h3 style={styles.subName}>{subcontractor.name}</h3>
                          <span style={styles.muted}>
                            {subcontractor.subcontractor_type === "owner_driver"
                              ? "Owner Driver"
                              : "Fleet Subcontractor"}
                          </span>
                        </div>
                        <StatusBadge result={compliance} />
                      </div>

                      <div style={styles.infoGrid}>
                        <Info
                          label="Contact"
                          value={subcontractor.contact_name || subcontractor.email}
                        />
                        <Info label="Phone" value={subcontractor.phone} />
                        <Info
                          label="Operator Licence"
                          value={subcontractor.operator_licence_number}
                        />
                        <Info
                          label="Terms"
                          value={`${subcontractor.payment_terms_days ?? 30} days`}
                        />
                      </div>

                      <div style={styles.actions}>
                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={() => {
                            setSelectedSubcontractorId(subcontractor.id);
                            startEdit(subcontractor);
                          }}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={() =>
                            setSelectedSubcontractorId(subcontractor.id)
                          }
                        >
                          Manage
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {selectedSubcontractor ? (
            <>
              <section style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h2 style={styles.sectionTitle}>
                      Employees · {selectedSubcontractor.name}
                    </h2>
                    <p style={styles.muted}>
                      Portal access should only be granted to active, directly
                      employed people.
                    </p>
                  </div>
                </div>

                <form onSubmit={saveEmployee} style={styles.inlineForm}>
                  <div style={styles.grid}>
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

                  <div style={styles.checkboxGrid}>
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

                  <div style={styles.actions}>
                    <button
                      type="submit"
                      style={styles.primaryButton}
                      disabled={employeeSaving}
                    >
                      {employeeSaving
                        ? "Saving..."
                        : editingEmployeeId
                          ? "Update Employee"
                          : "Add Employee"}
                    </button>

                    {editingEmployeeId ? (
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={resetEmployeeForm}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </form>

                <div style={styles.listGrid}>
                  {selectedEmployees.map((employee) => (
                    <article key={employee.id} style={styles.listCard}>
                      <div style={styles.subHeader}>
                        <div>
                          <strong>{employee.full_name}</strong>
                          <div style={styles.muted}>
                            {employee.job_title || "Employee"}
                          </div>
                        </div>

                        <span
                          style={
                            employee.directly_employed && employee.active
                              ? styles.goodBadge
                              : styles.warnBadge
                          }
                        >
                          {employee.directly_employed && employee.active
                            ? "Eligible"
                            : "No Portal Access"}
                        </span>
                      </div>

                      <div style={styles.infoGrid}>
                        <Info label="Email" value={employee.email} />
                        <Info label="Phone" value={employee.phone} />
                        <Info
                          label="Owner"
                          value={employee.owner ? "Yes" : "No"}
                        />
                        <Info
                          label="Directly Employed"
                          value={employee.directly_employed ? "Yes" : "No"}
                        />
                      </div>

                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={() => startEditEmployee(employee)}
                      >
                        Edit Employee
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <section style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h2 style={styles.sectionTitle}>
                      Vehicles · {selectedSubcontractor.name}
                    </h2>
                    <p style={styles.muted}>
                      Track MOT, tax, insurance and VOR status for subcontractor
                      vehicles.
                    </p>
                  </div>
                </div>

                <form onSubmit={saveVehicle} style={styles.inlineForm}>
                  <div style={styles.grid}>
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

                  <div style={styles.checkboxGrid}>
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

                  <div style={styles.actions}>
                    <button
                      type="submit"
                      style={styles.primaryButton}
                      disabled={vehicleSaving}
                    >
                      {vehicleSaving
                        ? "Saving..."
                        : editingVehicleId
                          ? "Update Vehicle"
                          : "Add Vehicle"}
                    </button>

                    {editingVehicleId ? (
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={resetVehicleForm}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </form>

                <div style={styles.listGrid}>
                  {selectedVehicles.map((vehicle) => {
                    const compliance = mostUrgent([
                      getCompliance(vehicle.mot_expiry),
                      getCompliance(vehicle.tax_expiry),
                      getCompliance(vehicle.insurance_expiry),
                    ]);

                    return (
                      <article
                        key={vehicle.id}
                        style={subcontractorCardStyle(compliance.level)}
                      >
                        <div style={styles.subHeader}>
                          <div>
                            <strong>{vehicle.registration}</strong>
                            <div style={styles.muted}>
                              {[vehicle.vehicle_type, vehicle.make, vehicle.model]
                                .filter(Boolean)
                                .join(" • ") || "Vehicle"}
                            </div>
                          </div>

                          <StatusBadge result={compliance} />
                        </div>

                        <div style={styles.infoGrid}>
                          <Info
                            label="MOT"
                            value={
                              vehicle.mot_expiry
                                ? formatDate(vehicle.mot_expiry)
                                : "Not set"
                            }
                          />
                          <Info
                            label="Tax"
                            value={
                              vehicle.tax_expiry
                                ? formatDate(vehicle.tax_expiry)
                                : "Not set"
                            }
                          />
                          <Info
                            label="Insurance"
                            value={
                              vehicle.insurance_expiry
                                ? formatDate(vehicle.insurance_expiry)
                                : "Not set"
                            }
                          />
                          <Info
                            label="VOR"
                            value={vehicle.vor ? "Yes" : "No"}
                          />
                        </div>

                        <button
                          type="button"
                          style={styles.secondaryButton}
                          onClick={() => startEditVehicle(vehicle)}
                        >
                          Edit Vehicle
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
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
    <section style={styles.section}>
      <h3 style={styles.subheading}>{title}</h3>
      {children}
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
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
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
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...styles.input, resize: "vertical" }}
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
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
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
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
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
    <label style={styles.checkbox}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <span style={styles.smallLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "—"}</strong>
    </div>
  );
}

function getCompliance(expiry: string | null): ComplianceResult {
  if (!expiry) {
    return {
      level: "amber",
      label: "DATE NEEDED",
      days: null,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiryDate = new Date(`${expiry}T00:00:00`);
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) {
    return {
      level: "red",
      label: `EXPIRED ${Math.abs(days)}d`,
      days,
    };
  }

  if (days <= 7) {
    return {
      level: "red",
      label: days === 0 ? "EXPIRES TODAY" : `NEEDS ATTENTION • ${days}d`,
      days,
    };
  }

  if (days <= 30) {
    return {
      level: "amber",
      label: `EXPIRING SOON • ${days}d`,
      days,
    };
  }

  return {
    level: "ok",
    label: `VALID • ${days}d`,
    days,
  };
}

function mostUrgent(results: ComplianceResult[]): ComplianceResult {
  const rank: Record<ComplianceLevel, number> = {
    ok: 0,
    amber: 1,
    red: 2,
  };

  return results.reduce((current, next) =>
    rank[next.level] > rank[current.level] ? next : current
  );
}

function StatusBadge({ result }: { result: ComplianceResult }) {
  const palette =
    result.level === "red"
      ? { background: "#fee2e2", color: "#991b1b", border: "#fca5a5" }
      : result.level === "amber"
        ? { background: "#fef3c7", color: "#92400e", border: "#fcd34d" }
        : { background: "#dcfce7", color: "#166534", border: "#86efac" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 9px",
        borderRadius: 999,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        color: palette.color,
        fontWeight: 900,
        fontSize: 11,
      }}
    >
      {result.label}
    </span>
  );
}

function subcontractorCardStyle(level: ComplianceLevel): CSSProperties {
  if (level === "red") {
    return {
      background: "#fff1f2",
      border: "2px solid #dc2626",
      borderRadius: 14,
      padding: 16,
    };
  }

  if (level === "amber") {
    return {
      background: "#fffbeb",
      border: "2px solid #f59e0b",
      borderRadius: 14,
      padding: 16,
    };
  }

  return {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
  };
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 20px 60px",
    background: "#f8fafc",
    color: "#0f172a",
  },
  container: {
    maxWidth: 1500,
    margin: "0 auto",
  },
  header: {
    marginBottom: 24,
  },
  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  title: {
    margin: 0,
    fontSize: "clamp(34px, 5vw, 48px)",
    letterSpacing: "-0.04em",
  },
  subtitle: {
    maxWidth: 820,
    margin: "8px 0 0",
    color: "#64748b",
    lineHeight: 1.6,
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 22,
    marginBottom: 22,
    boxShadow: "0 8px 28px rgba(15,23,42,0.06)",
  },
  section: {
    borderTop: "1px solid #e2e8f0",
    paddingTop: 18,
    marginTop: 18,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    fontSize: 22,
  },
  subheading: {
    margin: "0 0 14px",
    fontSize: 17,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 14,
    marginBottom: 14,
  },
  checkboxGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 8,
    marginBottom: 14,
  },
  field: {
    display: "grid",
    gap: 6,
  },
  label: {
    color: "#334155",
    fontSize: 12,
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "11px 12px",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
  },
  checkbox: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "#f8fafc",
    fontSize: 13,
    fontWeight: 700,
  },
  primaryButton: {
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff",
    color: "#0f172a",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  message: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 10,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  muted: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: 12,
  },
  subGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  listGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 14,
    marginTop: 18,
  },
  listCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
    background: "#f8fafc",
  },
  subHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  subName: {
    margin: 0,
    fontSize: 20,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    margin: "16px 0",
  },
  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: {
    display: "block",
    marginTop: 4,
    fontSize: 13,
  },
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  inlineForm: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid #e2e8f0",
  },
  goodBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: 11,
    fontWeight: 800,
  },
  warnBadge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: 11,
    fontWeight: 800,
  },
  empty: {
    padding: 40,
    textAlign: "center",
    color: "#64748b",
  },
};
