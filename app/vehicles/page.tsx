"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Card from "../../components/Card";
import MessageBanner from "../../components/MessageBanner";
import { cn } from "../../lib/cn";

type Vehicle = {
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

type FleetInsurancePolicy = {
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

type ComplianceLevel = "ok" | "amber" | "red";

type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};

const inputClasses =
  "h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3";

const selectClasses =
  "h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink";

const EMPTY_FORM = {
  registration: "",
  vehicle_type: "",
  make: "",
  model: "",
  mot_expiry: "",
  tax_expiry: "",
  insurance_type: "individual" as "individual" | "fleet",
  insurance_provider: "",
  insurance_policy_number: "",
  insurance_start_date: "",
  insurance_expiry: "",
  fleet_insurance_policy_id: "",
};


const EMPTY_FLEET_POLICY_FORM = {
  provider: "",
  policy_number: "",
  start_date: "",
  expiry_date: "",
  auto_renew: false,
  renewal_notice_days: "30",
  notes: "",
};

export default function VehiclesPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fleetPolicies, setFleetPolicies] = useState<FleetInsurancePolicy[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fleetPolicySaving, setFleetPolicySaving] = useState(false);
  const [editingFleetPolicyId, setEditingFleetPolicyId] = useState<string | null>(
    null
  );
  const [fleetPolicyForm, setFleetPolicyForm] = useState(
    EMPTY_FLEET_POLICY_FORM
  );

  const [form, setForm] = useState(EMPTY_FORM);

  async function loadVehicles() {
    setLoading(true);

    const [vehicleResult, policyResult] = await Promise.all([
      tenant
        .filterByTenant(supabase.from("vehicles").select("*"))
        .order("created_at", { ascending: false }),
      tenant
        .filterByTenant(
          supabase
            .from("fleet_insurance_policies")
            .select(
              "id, tenant_id, provider, policy_number, start_date, expiry_date, auto_renew, renewal_notice_days, active, notes"
            )
        )
        .order("expiry_date", { ascending: true }),
    ]);

    if (vehicleResult.error) {
      setMessage(vehicleResult.error.message);
      setVehicles([]);
    } else {
      setVehicles((vehicleResult.data as Vehicle[]) || []);
    }

    if (policyResult.error) {
      setMessage((current) =>
        current
          ? `${current} | ${policyResult.error?.message ?? ""}`
          : policyResult.error?.message ?? ""
      );
      setFleetPolicies([]);
    } else {
      setFleetPolicies(
        ((policyResult.data as FleetInsurancePolicy[]) || []).filter(
          (policy) => policy.active
        )
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.activeTenantId]);

  function resetFleetPolicyForm() {
    setEditingFleetPolicyId(null);
    setFleetPolicyForm(EMPTY_FLEET_POLICY_FORM);
  }

  function startEditFleetPolicy(policy: FleetInsurancePolicy) {
    setEditingFleetPolicyId(policy.id);
    setMessage("");

    setFleetPolicyForm({
      provider: policy.provider || "",
      policy_number: policy.policy_number || "",
      start_date: policy.start_date || "",
      expiry_date: policy.expiry_date || "",
      auto_renew: policy.auto_renew,
      renewal_notice_days: String(policy.renewal_notice_days ?? 30),
      notes: policy.notes || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveFleetPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isAdmin) {
      setMessage("Only an admin can manage fleet insurance.");
      return;
    }

    if (!fleetPolicyForm.provider.trim()) {
      setMessage("Fleet insurance provider is required.");
      return;
    }

    if (!fleetPolicyForm.policy_number.trim()) {
      setMessage("Fleet insurance policy number is required.");
      return;
    }

    if (!fleetPolicyForm.expiry_date) {
      setMessage("Fleet insurance expiry date is required.");
      return;
    }

    if (!editingFleetPolicyId && !tenant.writeTenantId) {
      setMessage("Pick a specific tenant before creating a fleet policy.");
      return;
    }

    const renewalNoticeDays = Number(
      fleetPolicyForm.renewal_notice_days || "30"
    );

    if (
      !Number.isFinite(renewalNoticeDays) ||
      renewalNoticeDays < 0 ||
      renewalNoticeDays > 365
    ) {
      setMessage("Renewal warning days must be between 0 and 365.");
      return;
    }

    setFleetPolicySaving(true);

    const payload = {
      provider: fleetPolicyForm.provider.trim(),
      policy_number: fleetPolicyForm.policy_number.trim(),
      start_date: fleetPolicyForm.start_date || null,
      expiry_date: fleetPolicyForm.expiry_date,
      auto_renew: fleetPolicyForm.auto_renew,
      renewal_notice_days: renewalNoticeDays,
      notes: fleetPolicyForm.notes.trim() || null,
      active: true,
      updated_at: new Date().toISOString(),
    };

    let error: { message?: string } | null = null;
    const wasEditing = Boolean(editingFleetPolicyId);

    if (editingFleetPolicyId) {
      const result = await tenant
        .filterByTenant(
          supabase
            .from("fleet_insurance_policies")
            .update(payload)
            .eq("id", editingFleetPolicyId)
        );

      error = result.error;
    } else {
      const result = await supabase.from("fleet_insurance_policies").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
        },
      ]);

      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save fleet insurance policy.");
      setFleetPolicySaving(false);
      return;
    }

    setMessage(
      wasEditing
        ? "Fleet insurance policy updated."
        : "Fleet insurance policy created."
    );

    resetFleetPolicyForm();
    await loadVehicles();
    setFleetPolicySaving(false);
  }

  async function deactivateFleetPolicy(policy: FleetInsurancePolicy) {
    if (!isAdmin) {
      setMessage("Only an admin can manage fleet insurance.");
      return;
    }

    const linkedVehicles = vehicles.filter(
      (vehicle) => vehicle.fleet_insurance_policy_id === policy.id
    );

    if (linkedVehicles.length > 0) {
      setMessage(
        `This policy is linked to ${linkedVehicles.length} vehicle${
          linkedVehicles.length === 1 ? "" : "s"
        }. Move those vehicles to another policy before deactivating it.`
      );
      return;
    }

    if (!window.confirm(`Deactivate fleet policy ${policy.policy_number}?`)) {
      return;
    }

    const result = await tenant.filterByTenant(
      supabase
        .from("fleet_insurance_policies")
        .update({
          active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", policy.id)
    );

    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (editingFleetPolicyId === policy.id) {
      resetFleetPolicyForm();
    }

    setMessage("Fleet insurance policy deactivated.");
    await loadVehicles();
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setMessage("");

    setForm({
      registration: vehicle.registration || "",
      vehicle_type: vehicle.vehicle_type || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      mot_expiry: vehicle.mot_expiry || "",
      tax_expiry: vehicle.tax_expiry || "",
      insurance_type:
        vehicle.insurance_type === "fleet" ? "fleet" : "individual",
      insurance_provider: vehicle.insurance_provider || "",
      insurance_policy_number: vehicle.insurance_policy_number || "",
      insurance_start_date: vehicle.insurance_start_date || "",
      insurance_expiry: vehicle.insurance_expiry || "",
      fleet_insurance_policy_id: vehicle.fleet_insurance_policy_id || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!form.registration.trim()) {
      setMessage("Registration required.");
      return;
    }

    if (!editingId && !tenant.writeTenantId) {
      setMessage("Pick a specific tenant to create records.");
      return;
    }

    if (
      form.insurance_type === "fleet" &&
      !form.fleet_insurance_policy_id
    ) {
      setMessage("Select a fleet insurance policy.");
      return;
    }

    setSaving(true);

    const payload = {
      registration: form.registration.trim().toUpperCase(),
      vehicle_type: form.vehicle_type.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      mot_expiry: form.mot_expiry || null,
      tax_expiry: form.tax_expiry || null,
      insurance_type: form.insurance_type,
      insurance_provider:
        form.insurance_type === "individual"
          ? form.insurance_provider.trim() || null
          : null,
      insurance_policy_number:
        form.insurance_type === "individual"
          ? form.insurance_policy_number.trim() || null
          : null,
      insurance_start_date:
        form.insurance_type === "individual"
          ? form.insurance_start_date || null
          : null,
      insurance_expiry:
        form.insurance_type === "individual"
          ? form.insurance_expiry || null
          : null,
      fleet_insurance_policy_id:
        form.insurance_type === "fleet"
          ? form.fleet_insurance_policy_id || null
          : null,
    };

    let error: { message?: string } | null = null;
    const wasEditing = Boolean(editingId);

    if (editingId) {
      const result = await supabase
        .from("vehicles")
        .update(payload)
        .eq("id", editingId);

      error = result.error;
    } else {
      const result = await supabase.from("vehicles").insert([
        {
          ...payload,
          tenant_id: tenant.writeTenantId,
          active: true,
        },
      ]);

      error = result.error;
    }

    if (error) {
      setMessage(error.message || "Unable to save vehicle.");
      setSaving(false);
      return;
    }

    resetForm();
    setMessage(wasEditing ? "Vehicle updated." : "Vehicle created.");
    await loadVehicles();
    setSaving(false);
  }

  async function deleteVehicle(id: string) {
    if (!isAdmin) {
      setMessage("Only an admin can change the fleet.");
      return;
    }

    if (!window.confirm("Delete vehicle?")) {
      return;
    }

    setMessage("");

    const { error } = await supabase.from("vehicles").delete().eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Vehicle deleted.");
    await loadVehicles();
  }

  async function toggleVehicle(id: string, active: boolean | null) {
    setMessage("");

    const { error } = await supabase
      .from("vehicles")
      .update({ active: !active })
      .eq("id", id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(!active ? "Vehicle activated." : "Vehicle deactivated.");
    await loadVehicles();
  }

  function getFleetPolicy(vehicle: Vehicle) {
    return fleetPolicies.find(
      (policy) => policy.id === vehicle.fleet_insurance_policy_id
    );
  }

  function getInsuranceExpiry(vehicle: Vehicle) {
    if (vehicle.insurance_type === "fleet") {
      return getFleetPolicy(vehicle)?.expiry_date ?? null;
    }

    return vehicle.insurance_expiry;
  }

  function getVehicleCardCompliance(vehicle: Vehicle): ComplianceResult {
    const mot = getCompliance(vehicle.mot_expiry);
    const tax = getCompliance(vehicle.tax_expiry);
    const insurance = getCompliance(getInsuranceExpiry(vehicle));

    return mostUrgent([mot, tax, insurance]);
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-kicker uppercase text-ink-3">Fleet</div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Vehicles
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Fleet, MOT, tax and insurance compliance.
              </p>
            </div>

            <ComplianceLegend />
          </header>

          {isAdmin ? (
            <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="m-0 text-md font-semibold text-ink">Fleet Insurance</h2>
                  <p className="m-0 mt-1 text-sm text-ink-3">
                    Manage the tenant fleet policy here. Vehicles using Fleet
                    Policy automatically inherit its insurer and expiry date.
                  </p>
                </div>

                {editingFleetPolicyId ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={resetFleetPolicyForm}
                  >
                    Cancel Policy Edit
                  </Button>
                ) : null}
              </div>

              {fleetPolicies.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {fleetPolicies.map((policy) => {
                    const policyCompliance = getCompliance(policy.expiry_date);
                    const linkedCount = vehicles.filter(
                      (vehicle) =>
                        vehicle.fleet_insurance_policy_id === policy.id
                    ).length;

                    return (
                      <article
                        key={policy.id}
                        className="rounded-lg border border-line bg-surface-2 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <strong className="block text-ink">
                              {policy.provider}
                            </strong>
                            <span className="font-mono text-sm text-ink-2">
                              {policy.policy_number}
                            </span>
                          </div>

                          <StatusBadge result={policyCompliance} small />
                        </div>

                        <div className="my-3 grid gap-2">
                          <div className="text-sm">
                            <span className="text-kicker uppercase text-ink-3">Start</span>{" "}
                            <strong className="block font-mono text-ink">
                              {policy.start_date
                                ? formatDate(policy.start_date)
                                : "Not set"}
                            </strong>
                          </div>
                          <div className="text-sm">
                            <span className="text-kicker uppercase text-ink-3">Expiry</span>{" "}
                            <strong className="block font-mono text-ink">
                              {formatDate(policy.expiry_date)}
                            </strong>
                          </div>
                          <div className="text-sm">
                            <span className="text-kicker uppercase text-ink-3">Auto renew</span>{" "}
                            <strong className="block text-ink">
                              {policy.auto_renew ? "Yes" : "No"}
                            </strong>
                          </div>
                          <div className="text-sm">
                            <span className="text-kicker uppercase text-ink-3">Renewal warning</span>{" "}
                            <strong className="block font-mono text-ink">
                              {policy.renewal_notice_days} days
                            </strong>
                          </div>
                          <div className="text-sm">
                            <span className="text-kicker uppercase text-ink-3">Vehicles covered</span>{" "}
                            <strong className="block font-mono text-ink">{linkedCount}</strong>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            onClick={() => startEditFleetPolicy(policy)}
                          >
                            Edit Policy
                          </Button>

                          <Button
                            variant="danger"
                            size="sm"
                            type="button"
                            onClick={() => void deactivateFleetPolicy(policy)}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
                  No active fleet insurance policy is configured yet.
                </div>
              )}

              <form
                onSubmit={saveFleetPolicy}
                className="mt-3 grid gap-3 border-t border-line pt-3"
              >
                <SectionTitle>
                  {editingFleetPolicyId
                    ? "Edit Fleet Policy"
                    : "Add Fleet Policy"}
                </SectionTitle>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Insurance Provider</span>
                    <input
                      className={inputClasses}
                      placeholder="e.g. Aviva"
                      value={fleetPolicyForm.provider}
                      onChange={(event) =>
                        setFleetPolicyForm({
                          ...fleetPolicyForm,
                          provider: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Policy Number</span>
                    <input
                      className={inputClasses}
                      placeholder="Policy number"
                      value={fleetPolicyForm.policy_number}
                      onChange={(event) =>
                        setFleetPolicyForm({
                          ...fleetPolicyForm,
                          policy_number: event.target.value,
                        })
                      }
                    />
                  </label>

                  <DateField
                    label="Policy Start Date"
                    value={fleetPolicyForm.start_date}
                    onChange={(value) =>
                      setFleetPolicyForm({
                        ...fleetPolicyForm,
                        start_date: value,
                      })
                    }
                  />

                  <DateField
                    label="Policy Expiry Date"
                    value={fleetPolicyForm.expiry_date}
                    onChange={(value) =>
                      setFleetPolicyForm({
                        ...fleetPolicyForm,
                        expiry_date: value,
                      })
                    }
                  />

                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Renewal Warning (days)</span>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      className={inputClasses}
                      value={fleetPolicyForm.renewal_notice_days}
                      onChange={(event) =>
                        setFleetPolicyForm({
                          ...fleetPolicyForm,
                          renewal_notice_days: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Auto Renew</span>
                    <span className="flex min-h-10 items-center gap-2 rounded-md border border-ink-3 bg-surface px-3 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        checked={fleetPolicyForm.auto_renew}
                        onChange={(event) =>
                          setFleetPolicyForm({
                            ...fleetPolicyForm,
                            auto_renew: event.target.checked,
                          })
                        }
                      />
                      Expected to renew automatically
                    </span>
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Policy Notes</span>
                  <textarea
                    rows={3}
                    className="min-h-24 w-full min-w-0 resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-3"
                    placeholder="Fleet policy notes"
                    value={fleetPolicyForm.notes}
                    onChange={(event) =>
                      setFleetPolicyForm({
                        ...fleetPolicyForm,
                        notes: event.target.value,
                      })
                    }
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={fleetPolicySaving}>
                    {fleetPolicySaving
                      ? "Saving Policy..."
                      : editingFleetPolicyId
                        ? "Update Fleet Policy"
                        : "Add Fleet Policy"}
                  </Button>

                  {editingFleetPolicyId ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={resetFleetPolicyForm}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            </section>
          ) : null}

          {isAdmin ? (
            <form
              onSubmit={saveVehicle}
              className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <h2 className="m-0 text-md font-semibold text-ink">
                {editingId ? "Edit Vehicle" : "Add Vehicle"}
              </h2>

              <SectionTitle>Vehicle Details</SectionTitle>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input
                  className={inputClasses}
                  placeholder="Registration"
                  value={form.registration}
                  onChange={(event) =>
                    setForm({ ...form, registration: event.target.value })
                  }
                />

                <input
                  className={inputClasses}
                  placeholder="Vehicle type"
                  value={form.vehicle_type}
                  onChange={(event) =>
                    setForm({ ...form, vehicle_type: event.target.value })
                  }
                />

                <input
                  className={inputClasses}
                  placeholder="Make"
                  value={form.make}
                  onChange={(event) =>
                    setForm({ ...form, make: event.target.value })
                  }
                />

                <input
                  className={inputClasses}
                  placeholder="Model"
                  value={form.model}
                  onChange={(event) =>
                    setForm({ ...form, model: event.target.value })
                  }
                />
              </div>

              <SectionTitle>MOT & Tax</SectionTitle>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DateField
                  label="MOT Expiry"
                  value={form.mot_expiry}
                  onChange={(value) => setForm({ ...form, mot_expiry: value })}
                />

                <DateField
                  label="Tax Expiry"
                  value={form.tax_expiry}
                  onChange={(value) => setForm({ ...form, tax_expiry: value })}
                />
              </div>

              <SectionTitle>Insurance</SectionTitle>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Insurance Type</span>
                  <select
                    className={selectClasses}
                    value={form.insurance_type}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        insurance_type: event.target.value as
                          | "individual"
                          | "fleet",
                      })
                    }
                  >
                    <option value="individual">Individual Policy</option>
                    <option value="fleet">Fleet Policy</option>
                  </select>
                </label>

                {form.insurance_type === "fleet" ? (
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium text-ink-2">Fleet Insurance Policy</span>
                    <select
                      className={selectClasses}
                      value={form.fleet_insurance_policy_id}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          fleet_insurance_policy_id: event.target.value,
                        })
                      }
                    >
                      <option value="">Select fleet policy</option>
                      {fleetPolicies.map((policy) => (
                        <option key={policy.id} value={policy.id}>
                          {policy.provider} • {policy.policy_number} • expires{" "}
                          {formatDate(policy.expiry_date)}
                          {policy.auto_renew ? " • auto renew" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <input
                      className={inputClasses}
                      placeholder="Insurance provider"
                      value={form.insurance_provider}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          insurance_provider: event.target.value,
                        })
                      }
                    />

                    <input
                      className={inputClasses}
                      placeholder="Policy number"
                      value={form.insurance_policy_number}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          insurance_policy_number: event.target.value,
                        })
                      }
                    />

                    <DateField
                      label="Insurance Start"
                      value={form.insurance_start_date}
                      onChange={(value) =>
                        setForm({ ...form, insurance_start_date: value })
                      }
                    />

                    <DateField
                      label="Insurance Expiry"
                      value={form.insurance_expiry}
                      onChange={(value) =>
                        setForm({ ...form, insurance_expiry: value })
                      }
                    />
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : editingId ? "Update" : "Add"}
                </Button>

                {editingId ? (
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}

          <MessageBanner tone="neutral">{message}</MessageBanner>

          {loading ? <Card className="mb-4">Loading vehicles...</Card> : null}

          <div className="grid gap-4">
            {vehicles.map((vehicle) => {
              const cardCompliance = getVehicleCardCompliance(vehicle);
              const mot = getCompliance(vehicle.mot_expiry);
              const tax = getCompliance(vehicle.tax_expiry);
              const policy = getFleetPolicy(vehicle);
              const insuranceExpiry = getInsuranceExpiry(vehicle);
              const insurance = getCompliance(insuranceExpiry);

              return (
                <div
                  key={vehicle.id}
                  className={cn(
                    vehicleCardStyle(cardCompliance.level),
                    !vehicle.active && "opacity-70"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="m-0 font-mono text-md font-semibold text-ink">
                        {vehicle.registration}
                      </h3>

                      <div className="text-sm text-ink-3">
                        {vehicle.vehicle_type || "No type"} •{" "}
                        {vehicle.make || "-"} {vehicle.model || ""}
                      </div>
                    </div>

                    <StatusBadge result={cardCompliance} />
                  </div>

                  <div className="my-3 grid gap-2 sm:grid-cols-3">
                    <ComplianceItem
                      label="MOT"
                      expiry={vehicle.mot_expiry}
                      result={mot}
                    />

                    <ComplianceItem
                      label="Tax"
                      expiry={vehicle.tax_expiry}
                      result={tax}
                    />

                    <ComplianceItem
                      label="Insurance"
                      expiry={insuranceExpiry}
                      result={insurance}
                      extra={
                        vehicle.insurance_type === "fleet"
                          ? policy
                            ? `Fleet • ${policy.provider}${
                                policy.auto_renew ? " • Auto renew" : ""
                              }`
                            : "Fleet policy not selected"
                          : vehicle.insurance_provider || "Individual policy"
                      }
                    />
                  </div>

                  <div className="text-sm text-ink-2">
                    Status: {vehicle.active ? "Active" : "Inactive"}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {isAdmin ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={() => startEdit(vehicle)}
                        >
                          Edit
                        </Button>

                        <Button
                          variant="danger"
                          size="sm"
                          type="button"
                          onClick={() => void deleteVehicle(vehicle.id)}
                        >
                          Delete
                        </Button>
                      </>
                    ) : null}

                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() =>
                        void toggleVehicle(vehicle.id, vehicle.active)
                      }
                    >
                      {vehicle.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </TenantGate>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-kicker uppercase text-ink-3">{children}</div>
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
        className={inputClasses}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ComplianceLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone="success">31+ days</Badge>
      <Badge tone="warning">30–8 days</Badge>
      <Badge tone="danger">7 days / expired</Badge>
    </div>
  );
}

function ComplianceItem({
  label,
  expiry,
  result,
  extra,
}: {
  label: string;
  expiry: string | null;
  result: ComplianceResult;
  extra?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-2.5">
      <span className="block text-kicker uppercase text-ink-3">{label}</span>

      <div className="font-mono text-sm font-semibold text-ink">
        {expiry ? formatDate(expiry) : "Not set"}
      </div>

      {extra ? <div className="text-xs text-ink-3">{extra}</div> : null}

      <div className="mt-2">
        <StatusBadge result={result} small />
      </div>
    </div>
  );
}

function StatusBadge({
  result,
}: {
  result: ComplianceResult;
  /** Accepted for call-site compatibility; Badge has a single size. */
  small?: boolean;
}) {
  return (
    <Badge
      tone={
        result.level === "red"
          ? "danger"
          : result.level === "amber"
            ? "warning"
            : "success"
      }
    >
      {result.label}
    </Badge>
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

  const today = startOfToday();
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const diffMs = expiryDate.getTime() - today.getTime();
  const days = Math.ceil(diffMs / 86_400_000);

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

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB");
}

function vehicleCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-4";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-4";
  }

  return "rounded-lg border border-line bg-surface p-4 shadow-sm";
}
