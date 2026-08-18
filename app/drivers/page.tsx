"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import Badge from "../../components/Badge";
import Button from "../../components/Button";

type Driver = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  licence_number: string | null;
  active: boolean | null;
  driver_type: string | null;
  licence_expiry: string | null;
  tachograph_card_number: string | null;
  tachograph_expiry: string | null;

  date_of_birth: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postcode: string | null;
  employee_number: string | null;
  start_date: string | null;
  end_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  depot: string | null;
  notes: string | null;

  licence_issue_date: string | null;
  licence_check_date: string | null;
  licence_check_due: string | null;
  licence_check_reference: string | null;
  licence_status: string | null;
  licence_categories: string[] | null;
  points_total: number | null;
  disqualified: boolean | null;
  disqualified_until: string | null;
  licence_restriction_notes: string | null;

  tachograph_required: boolean | null;
  tachograph_issue_date: string | null;
  tachograph_last_download: string | null;
  tachograph_next_download_due: string | null;
  tachograph_status: string | null;

  cpc_required: boolean | null;
  cpc_qualified: boolean | null;
  cpc_expiry: string | null;
  cpc_training_hours: number | null;
  cpc_notes: string | null;

  adr_required: boolean | null;
  adr_qualified: boolean | null;
  adr_certificate_number: string | null;
  adr_classes: string[] | null;
  adr_expiry: string | null;
  adr_notes: string | null;

  last_medical_date: string | null;
  next_medical_due: string | null;
  medical_restrictions: string | null;

  right_to_work_checked_at: string | null;
  right_to_work_expiry: string | null;
  right_to_work_reference: string | null;
};

type Vehicle = {
  id: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  vor: boolean | null;
};

type VehicleAssignment = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  assigned_from: string;
  active: boolean;
  notes: string | null;
};

type LicenceCheck = {
  id: string;
  driver_id: string;
  checked_at: string;
  next_check_due: string | null;
  licence_number: string | null;
  licence_status: string | null;
  licence_expiry: string | null;
  points_total: number;
  disqualified: boolean;
  check_reference: string | null;
  check_code: string | null;
  notes: string | null;
};

type Endorsement = {
  id: string;
  driver_id: string;
  code: string;
  points: number;
  offence_date: string | null;
  conviction_date: string | null;
  endorsement_expiry: string | null;
  active: boolean;
  description: string | null;
  notes: string | null;
};

type Training = {
  id: string;
  driver_id: string;
  training_type: string;
  course_name: string | null;
  provider: string | null;
  certificate_number: string | null;
  completed_date: string | null;
  expiry_date: string | null;
  training_hours: number | null;
  status: string | null;
  notes: string | null;
};

type DriverForm = {
  name: string;
  phone: string;
  email: string;
  employee_number: string;
  driver_type: string;

  date_of_birth: string;
  start_date: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  postcode: string;
  depot: string;

  emergency_contact_name: string;
  emergency_contact_phone: string;

  licence_number: string;
  licence_issue_date: string;
  licence_expiry: string;
  licence_check_date: string;
  licence_check_due: string;
  licence_check_reference: string;
  licence_status: string;
  licence_categories: string;
  points_total: string;
  disqualified: boolean;
  disqualified_until: string;
  licence_restriction_notes: string;

  tachograph_required: boolean;
  tachograph_card_number: string;
  tachograph_issue_date: string;
  tachograph_expiry: string;
  tachograph_last_download: string;
  tachograph_next_download_due: string;

  cpc_required: boolean;
  cpc_qualified: boolean;
  cpc_expiry: string;
  cpc_training_hours: string;
  cpc_notes: string;

  adr_required: boolean;
  adr_qualified: boolean;
  adr_certificate_number: string;
  adr_classes: string;
  adr_expiry: string;
  adr_notes: string;

  last_medical_date: string;
  next_medical_due: string;
  medical_restrictions: string;

  right_to_work_checked_at: string;
  right_to_work_expiry: string;
  right_to_work_reference: string;

  notes: string;
  active: boolean;
};

const EMPTY_FORM: DriverForm = {
  name: "",
  phone: "",
  email: "",
  employee_number: "",
  driver_type: "employee",

  date_of_birth: "",
  start_date: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  postcode: "",
  depot: "",

  emergency_contact_name: "",
  emergency_contact_phone: "",

  licence_number: "",
  licence_issue_date: "",
  licence_expiry: "",
  licence_check_date: "",
  licence_check_due: "",
  licence_check_reference: "",
  licence_status: "valid",
  licence_categories: "",
  points_total: "0",
  disqualified: false,
  disqualified_until: "",
  licence_restriction_notes: "",

  tachograph_required: true,
  tachograph_card_number: "",
  tachograph_issue_date: "",
  tachograph_expiry: "",
  tachograph_last_download: "",
  tachograph_next_download_due: "",

  cpc_required: true,
  cpc_qualified: false,
  cpc_expiry: "",
  cpc_training_hours: "0",
  cpc_notes: "",

  adr_required: false,
  adr_qualified: false,
  adr_certificate_number: "",
  adr_classes: "",
  adr_expiry: "",
  adr_notes: "",

  last_medical_date: "",
  next_medical_due: "",
  medical_restrictions: "",

  right_to_work_checked_at: "",
  right_to_work_expiry: "",
  right_to_work_reference: "",

  notes: "",
  active: true,
};

export default function DriversPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tenantId, setTenantId] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<VehicleAssignment[]>([]);
  const [checks, setChecks] = useState<LicenceCheck[]>([]);
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [training, setTraining] = useState<Training[]>([]);

  const [form, setForm] = useState<DriverForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const [vehicleToAssign, setVehicleToAssign] = useState("");
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentDebug, setAssignmentDebug] = useState(
    "Assignment debug: waiting for button click."
  );

  const [checkCode, setCheckCode] = useState("");
  const [checkNotes, setCheckNotes] = useState("");

  const [endorsementCode, setEndorsementCode] = useState("");
  const [endorsementPoints, setEndorsementPoints] = useState("");
  const [endorsementDescription, setEndorsementDescription] = useState("");
  const [endorsementExpiry, setEndorsementExpiry] = useState("");

  const [trainingType, setTrainingType] = useState("");
  const [trainingCourse, setTrainingCourse] = useState("");
  const [trainingProvider, setTrainingProvider] = useState("");
  const [trainingExpiry, setTrainingExpiry] = useState("");
  const [trainingHours, setTrainingHours] = useState("");

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const resolveTenant = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      window.location.href = "/";
      return null;
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (error) {
      throw error;
    }

    if (!profile?.tenant_id) {
      throw new Error("User is not linked to a tenant.");
    }

    return profile.tenant_id as string;
  }, [supabase]);

  const loadData = useCallback(
    async (currentTenantId: string) => {
      setLoading(true);
      setErrorMessage("");

      try {
        const [
          driversResult,
          vehiclesResult,
          assignmentsResult,
          checksResult,
          endorsementsResult,
          trainingResult,
        ] = await Promise.all([
          supabase
            .from("drivers")
            .select("*")
            .eq("tenant_id", currentTenantId)
            .order("name"),

          supabase
            .from("vehicles")
            .select("id, registration, make, model, active, vor")
            .eq("tenant_id", currentTenantId)
            .order("registration"),

          supabase
            .from("vehicle_assignments")
            .select("*")
            .eq("tenant_id", currentTenantId)
            .eq("active", true),

          supabase
            .from("driver_licence_checks")
            .select("*")
            .eq("tenant_id", currentTenantId)
            .order("checked_at", { ascending: false }),

          supabase
            .from("driver_licence_endorsements")
            .select("*")
            .eq("tenant_id", currentTenantId)
            .order("created_at", { ascending: false }),

          supabase
            .from("driver_training")
            .select("*")
            .eq("tenant_id", currentTenantId)
            .order("created_at", { ascending: false }),
        ]);

        const error =
          driversResult.error ||
          vehiclesResult.error ||
          assignmentsResult.error ||
          checksResult.error ||
          endorsementsResult.error ||
          trainingResult.error;

        if (error) {
          throw error;
        }

        setDrivers((driversResult.data ?? []) as Driver[]);
        setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
        setAssignments(
          (assignmentsResult.data ?? []) as VehicleAssignment[]
        );
        setChecks((checksResult.data ?? []) as LicenceCheck[]);
        setEndorsements(
          (endorsementsResult.data ?? []) as Endorsement[]
        );
        setTraining((trainingResult.data ?? []) as Training[]);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load driver data."
        );
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    async function initialise() {
      try {
        const id = await resolveTenant();

        if (!id) {
          return;
        }

        setTenantId(id);
        await loadData(id);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialise drivers."
        );
        setLoading(false);
      }
    }

    void initialise();
  }, [resolveTenant, loadData]);

  function updateForm<K extends keyof DriverForm>(
    field: K,
    value: DriverForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearMessages() {
    setMessage("");
    setErrorMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function editDriver(driver: Driver) {
    setEditingId(driver.id);
    setSelectedDriverId(driver.id);

    setForm({
      name: driver.name ?? "",
      phone: driver.phone ?? "",
      email: driver.email ?? "",
      employee_number: driver.employee_number ?? "",
      driver_type: driver.driver_type ?? "employee",

      date_of_birth: driver.date_of_birth ?? "",
      start_date: driver.start_date ?? "",
      address_line_1: driver.address_line_1 ?? "",
      address_line_2: driver.address_line_2 ?? "",
      city: driver.city ?? "",
      postcode: driver.postcode ?? "",
      depot: driver.depot ?? "",

      emergency_contact_name: driver.emergency_contact_name ?? "",
      emergency_contact_phone: driver.emergency_contact_phone ?? "",

      licence_number: driver.licence_number ?? "",
      licence_issue_date: driver.licence_issue_date ?? "",
      licence_expiry: driver.licence_expiry ?? "",
      licence_check_date: driver.licence_check_date ?? "",
      licence_check_due: driver.licence_check_due ?? "",
      licence_check_reference: driver.licence_check_reference ?? "",
      licence_status: driver.licence_status ?? "valid",
      licence_categories: (driver.licence_categories ?? []).join(", "),
      points_total: String(driver.points_total ?? 0),
      disqualified: driver.disqualified ?? false,
      disqualified_until: driver.disqualified_until ?? "",
      licence_restriction_notes:
        driver.licence_restriction_notes ?? "",

      tachograph_required: driver.tachograph_required ?? true,
      tachograph_card_number: driver.tachograph_card_number ?? "",
      tachograph_issue_date: driver.tachograph_issue_date ?? "",
      tachograph_expiry: driver.tachograph_expiry ?? "",
      tachograph_last_download: driver.tachograph_last_download ?? "",
      tachograph_next_download_due:
        driver.tachograph_next_download_due ?? "",

      cpc_required: driver.cpc_required ?? true,
      cpc_qualified: driver.cpc_qualified ?? false,
      cpc_expiry: driver.cpc_expiry ?? "",
      cpc_training_hours: String(driver.cpc_training_hours ?? 0),
      cpc_notes: driver.cpc_notes ?? "",

      adr_required: driver.adr_required ?? false,
      adr_qualified: driver.adr_qualified ?? false,
      adr_certificate_number: driver.adr_certificate_number ?? "",
      adr_classes: (driver.adr_classes ?? []).join(", "),
      adr_expiry: driver.adr_expiry ?? "",
      adr_notes: driver.adr_notes ?? "",

      last_medical_date: driver.last_medical_date ?? "",
      next_medical_due: driver.next_medical_due ?? "",
      medical_restrictions: driver.medical_restrictions ?? "",

      right_to_work_checked_at: driver.right_to_work_checked_at ?? "",
      right_to_work_expiry: driver.right_to_work_expiry ?? "",
      right_to_work_reference: driver.right_to_work_reference ?? "",

      notes: driver.notes ?? "",
      active: driver.active ?? true,
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tenantId) {
      return;
    }

    clearMessages();
    setSaving(true);

    try {
      const payload = {
        tenant_id: tenantId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        employee_number: form.employee_number.trim() || null,
        driver_type: form.driver_type || null,

        date_of_birth: form.date_of_birth || null,
        start_date: form.start_date || null,
        address_line_1: form.address_line_1.trim() || null,
        address_line_2: form.address_line_2.trim() || null,
        city: form.city.trim() || null,
        postcode: form.postcode.trim().toUpperCase() || null,
        depot: form.depot.trim() || null,

        emergency_contact_name:
          form.emergency_contact_name.trim() || null,
        emergency_contact_phone:
          form.emergency_contact_phone.trim() || null,

        licence_number: form.licence_number.trim() || null,
        licence_issue_date: form.licence_issue_date || null,
        licence_expiry: form.licence_expiry || null,
        licence_check_date: form.licence_check_date || null,
        licence_check_due: form.licence_check_due || null,
        licence_check_reference:
          form.licence_check_reference.trim() || null,
        licence_status: form.licence_status || null,
        licence_categories: splitCsv(form.licence_categories),
        points_total: Number(form.points_total || 0),
        disqualified: form.disqualified,
        disqualified_until: form.disqualified_until || null,
        licence_restriction_notes:
          form.licence_restriction_notes.trim() || null,

        tachograph_required: form.tachograph_required,
        tachograph_card_number:
          form.tachograph_card_number.trim() || null,
        tachograph_issue_date: form.tachograph_issue_date || null,
        tachograph_expiry: form.tachograph_expiry || null,
        tachograph_last_download:
          form.tachograph_last_download || null,
        tachograph_next_download_due:
          form.tachograph_next_download_due || null,

        cpc_required: form.cpc_required,
        cpc_qualified: form.cpc_qualified,
        cpc_expiry: form.cpc_expiry || null,
        cpc_training_hours: Number(form.cpc_training_hours || 0),
        cpc_notes: form.cpc_notes.trim() || null,

        adr_required: form.adr_required,
        adr_qualified: form.adr_qualified,
        adr_certificate_number:
          form.adr_certificate_number.trim() || null,
        adr_classes: splitCsv(form.adr_classes),
        adr_expiry: form.adr_expiry || null,
        adr_notes: form.adr_notes.trim() || null,

        last_medical_date: form.last_medical_date || null,
        next_medical_due: form.next_medical_due || null,
        medical_restrictions:
          form.medical_restrictions.trim() || null,

        right_to_work_checked_at:
          form.right_to_work_checked_at || null,
        right_to_work_expiry:
          form.right_to_work_expiry || null,
        right_to_work_reference:
          form.right_to_work_reference.trim() || null,

        notes: form.notes.trim() || null,
        active: form.active,
      };

      if (editingId) {
        const { error } = await supabase
          .from("drivers")
          .update(payload)
          .eq("id", editingId)
          .eq("tenant_id", tenantId);

        if (error) {
          throw error;
        }

        setMessage("Driver updated.");
      } else {
        const { data, error } = await supabase
          .from("drivers")
          .insert(payload)
          .select("id")
          .single();

        if (error) {
          throw error;
        }

        setSelectedDriverId(data.id);
        setMessage("Driver created.");
      }

      resetForm();
      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save driver."
      );
    } finally {
      setSaving(false);
    }
  }

  async function assignVehicle() {
    const driverId = selectedDriverId;
    const vehicleId = vehicleToAssign;

    console.log("[vehicle-assignment] button handler started", {
      driverId,
      vehicleId,
      tenantId,
      assignmentNotes,
    });

    setAssignmentDebug(
      `CLICK RECEIVED\nDriver: ${driverId ?? "NONE"}\nVehicle: ${
        vehicleId || "NONE"
      }\nTenant: ${tenantId ?? "NONE"}`
    );

    if (!driverId) {
      const message = "No driver is selected.";
      console.error("[vehicle-assignment]", message);
      setErrorMessage(message);
      setAssignmentDebug(`FAILED BEFORE RPC\n${message}`);
      window.alert(message);
      return;
    }

    if (!vehicleId) {
      const message = "No vehicle is selected.";
      console.error("[vehicle-assignment]", message);
      setErrorMessage(message);
      setAssignmentDebug(`FAILED BEFORE RPC\n${message}`);
      window.alert(message);
      return;
    }

    if (!tenantId) {
      const message = "Tenant has not loaded.";
      console.error("[vehicle-assignment]", message);
      setErrorMessage(message);
      setAssignmentDebug(`FAILED BEFORE RPC\n${message}`);
      window.alert(message);
      return;
    }

    clearMessages();
    setAssignmentSaving(true);

    try {
      setAssignmentDebug(
        `CALLING RPC\nDriver: ${driverId}\nVehicle: ${vehicleId}\nTenant: ${tenantId}`
      );

      console.log(
        "[vehicle-assignment] calling assign_driver_to_vehicle RPC"
      );

      const { data, error } = await supabase.rpc(
        "assign_driver_to_vehicle",
        {
          p_vehicle_id: vehicleId,
          p_driver_id: driverId,
          p_notes: assignmentNotes.trim() || null,
        }
      );

      console.log("[vehicle-assignment] RPC response", {
        data,
        error,
      });

      if (error) {
        const details = [
          `Message: ${error.message}`,
          `Code: ${error.code ?? "unknown"}`,
          `Details: ${error.details ?? "none"}`,
          `Hint: ${error.hint ?? "none"}`,
        ].join("\n");

        setAssignmentDebug(`RPC FAILED\n${details}`);

        window.alert(`Vehicle assignment failed.\n\n${details}`);

        throw error;
      }

      setAssignmentDebug(
        `RPC SUCCESS\nAssignment ID: ${String(
          data ?? "returned without an ID"
        )}\nReloading assignment data...`
      );

      setMessage("Vehicle assigned successfully.");

      await loadData(tenantId);

      setAssignmentDebug(
        `SUCCESS\nAssignment ID: ${String(
          data ?? "not returned"
        )}\nDriver: ${driverId}\nVehicle: ${vehicleId}`
      );

      setVehicleToAssign("");
      setAssignmentNotes("");

      window.alert("Vehicle assigned successfully.");
    } catch (error) {
      console.error("[vehicle-assignment] exception", error);

      const errorText =
        error instanceof Error
          ? error.message
          : "Unable to assign vehicle.";

      setErrorMessage(errorText);

      setAssignmentDebug((current) =>
        current.startsWith("RPC FAILED")
          ? current
          : `ASSIGNMENT EXCEPTION\n${errorText}`
      );
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function unassignVehicle(vehicleId: string) {
    const confirmed = window.confirm("Unassign this vehicle?");

    if (!confirmed) {
      return;
    }

    try {
      const { error } = await supabase.rpc("unassign_vehicle", {
        p_vehicle_id: vehicleId,
      });

      if (error) {
        throw error;
      }

      setMessage("Vehicle unassigned.");

      if (tenantId) {
        await loadData(tenantId);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to unassign vehicle."
      );
    }
  }

  async function recordLicenceCheck(driver: Driver) {
    if (!tenantId) {
      return;
    }

    const checkedAt = new Date().toISOString().slice(0, 10);

    const nextDue =
      form.licence_check_due ||
      addMonths(checkedAt, 6);

    try {
      const { error } = await supabase
        .from("driver_licence_checks")
        .insert({
          tenant_id: tenantId,
          driver_id: driver.id,
          checked_at: checkedAt,
          next_check_due: nextDue,
          licence_number: driver.licence_number,
          licence_status: driver.licence_status,
          licence_expiry: driver.licence_expiry,
          points_total: driver.points_total ?? 0,
          disqualified: driver.disqualified ?? false,
          check_reference:
            form.licence_check_reference || null,
          check_code: checkCode.trim() || null,
          notes: checkNotes.trim() || null,
        });

      if (error) {
        throw error;
      }

      const { error: updateError } = await supabase
        .from("drivers")
        .update({
          licence_check_date: checkedAt,
          licence_check_due: nextDue,
        })
        .eq("id", driver.id)
        .eq("tenant_id", tenantId);

      if (updateError) {
        throw updateError;
      }

      setCheckCode("");
      setCheckNotes("");
      setMessage("Licence check recorded.");

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to record licence check."
      );
    }
  }

  async function addEndorsement() {
    if (!tenantId || !selectedDriverId || !endorsementCode.trim()) {
      return;
    }

    try {
      const points = Number(endorsementPoints || 0);

      const { error } = await supabase
        .from("driver_licence_endorsements")
        .insert({
          tenant_id: tenantId,
          driver_id: selectedDriverId,
          code: endorsementCode.trim().toUpperCase(),
          points,
          description: endorsementDescription.trim() || null,
          endorsement_expiry: endorsementExpiry || null,
          active: true,
        });

      if (error) {
        throw error;
      }

      const activePoints = endorsements
        .filter(
          (item) =>
            item.driver_id === selectedDriverId &&
            item.active
        )
        .reduce((total, item) => total + item.points, 0);

      await supabase
        .from("drivers")
        .update({
          points_total: activePoints + points,
        })
        .eq("id", selectedDriverId)
        .eq("tenant_id", tenantId);

      setEndorsementCode("");
      setEndorsementPoints("");
      setEndorsementDescription("");
      setEndorsementExpiry("");
      setMessage("Endorsement added.");

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to add endorsement."
      );
    }
  }

  async function deleteEndorsement(endorsement: Endorsement) {
    if (!tenantId) {
      return;
    }

    if (!window.confirm(`Remove endorsement ${endorsement.code}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("driver_licence_endorsements")
        .delete()
        .eq("id", endorsement.id);

      if (error) {
        throw error;
      }

      const remainingPoints = endorsements
        .filter(
          (item) =>
            item.driver_id === endorsement.driver_id &&
            item.id !== endorsement.id &&
            item.active
        )
        .reduce((total, item) => total + item.points, 0);

      await supabase
        .from("drivers")
        .update({
          points_total: remainingPoints,
        })
        .eq("id", endorsement.driver_id)
        .eq("tenant_id", tenantId);

      setMessage("Endorsement removed.");

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to remove endorsement."
      );
    }
  }

  async function addTraining() {
    if (!tenantId || !selectedDriverId || !trainingType.trim()) {
      return;
    }

    try {
      const { error } = await supabase
        .from("driver_training")
        .insert({
          tenant_id: tenantId,
          driver_id: selectedDriverId,
          training_type: trainingType.trim(),
          course_name: trainingCourse.trim() || null,
          provider: trainingProvider.trim() || null,
          expiry_date: trainingExpiry || null,
          training_hours:
            trainingHours !== ""
              ? Number(trainingHours)
              : null,
          status: "valid",
        });

      if (error) {
        throw error;
      }

      setTrainingType("");
      setTrainingCourse("");
      setTrainingProvider("");
      setTrainingExpiry("");
      setTrainingHours("");

      setMessage("Training record added.");

      await loadData(tenantId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to add training."
      );
    }
  }

  const filteredDrivers = drivers.filter((driver) => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return [
      driver.name,
      driver.employee_number,
      driver.licence_number,
      driver.phone,
      driver.email,
    ]
      .filter(Boolean)
      .some((value) =>
        String(value).toLowerCase().includes(query)
      );
  });

  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ?? null;

  const selectedAssignment =
    assignments.find(
      (assignment) =>
        assignment.driver_id === selectedDriverId
    ) ?? null;

  const selectedVehicle =
    vehicles.find(
      (vehicle) =>
        vehicle.id === selectedAssignment?.vehicle_id
    ) ?? null;

  const selectedChecks = checks.filter(
    (check) => check.driver_id === selectedDriverId
  );

  const selectedEndorsements = endorsements.filter(
    (item) => item.driver_id === selectedDriverId
  );

  const selectedTraining = training.filter(
    (item) => item.driver_id === selectedDriverId
  );

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-[1480px] px-6 py-8">
        <header className="mb-4">
          <div>
            <div className="text-kicker uppercase text-ink-3">
              Fleet Compliance
            </div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Drivers
            </h1>
            <p className="text-sm text-ink-3">
              Driver records, licence checks, tachograph, CPC, ADR,
              medical compliance and vehicle allocation.
            </p>
          </div>
        </header>

        {errorMessage ? (
          <div className="mb-4 rounded-lg border border-danger-border bg-danger-tint p-3 text-sm text-danger-strong">
            {errorMessage}
          </div>
        ) : null}

        {message ? (
          <div className="mb-4 rounded-lg border border-success-border bg-success-tint p-3 text-sm text-success-strong">
            {message}
          </div>
        ) : null}

        <form
          onSubmit={saveDriver}
          className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-md font-semibold text-ink">
              {editingId ? "Edit Driver" : "Add Driver"}
            </h2>

            {editingId ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={resetForm}
              >
                Cancel
              </Button>
            ) : null}
          </div>

          <Section title="Driver Profile">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Full Name"
                value={form.name}
                onChange={(value) => updateForm("name", value)}
                required
              />

              <TextField
                label="Employee / Driver Number"
                value={form.employee_number}
                onChange={(value) =>
                  updateForm("employee_number", value)
                }
              />

              <TextField
                label="Phone"
                value={form.phone}
                onChange={(value) => updateForm("phone", value)}
              />

              <TextField
                label="Email"
                value={form.email}
                onChange={(value) => updateForm("email", value)}
                type="email"
              />

              <TextField
                label="Date of Birth"
                value={form.date_of_birth}
                onChange={(value) =>
                  updateForm("date_of_birth", value)
                }
                type="date"
              />

              <TextField
                label="Start Date"
                value={form.start_date}
                onChange={(value) =>
                  updateForm("start_date", value)
                }
                type="date"
              />

              <TextField
                label="Depot / Base"
                value={form.depot}
                onChange={(value) => updateForm("depot", value)}
              />

              <SelectField
                label="Driver Type"
                value={form.driver_type}
                onChange={(value) =>
                  updateForm("driver_type", value)
                }
                options={[
                  ["employee", "Employee"],
                  ["agency", "Agency"],
                  ["subcontractor", "Subcontractor"],
                  ["owner_driver", "Owner Driver"],
                ]}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Address Line 1"
                value={form.address_line_1}
                onChange={(value) =>
                  updateForm("address_line_1", value)
                }
              />

              <TextField
                label="Address Line 2"
                value={form.address_line_2}
                onChange={(value) =>
                  updateForm("address_line_2", value)
                }
              />

              <TextField
                label="City"
                value={form.city}
                onChange={(value) => updateForm("city", value)}
              />

              <TextField
                label="Postcode"
                value={form.postcode}
                onChange={(value) =>
                  updateForm("postcode", value.toUpperCase())
                }
              />
            </div>
          </Section>

          <Section title="Driving Licence">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Licence Number"
                value={form.licence_number}
                onChange={(value) =>
                  updateForm("licence_number", value)
                }
              />

              <TextField
                label="Issue Date"
                value={form.licence_issue_date}
                onChange={(value) =>
                  updateForm("licence_issue_date", value)
                }
                type="date"
              />

              <TextField
                label="Licence Expiry"
                value={form.licence_expiry}
                onChange={(value) =>
                  updateForm("licence_expiry", value)
                }
                type="date"
              />

              <TextField
                label="Last Licence Check"
                value={form.licence_check_date}
                onChange={(value) =>
                  updateForm("licence_check_date", value)
                }
                type="date"
              />

              <TextField
                label="Next Licence Check Due"
                value={form.licence_check_due}
                onChange={(value) =>
                  updateForm("licence_check_due", value)
                }
                type="date"
              />

              <TextField
                label="Check Reference"
                value={form.licence_check_reference}
                onChange={(value) =>
                  updateForm("licence_check_reference", value)
                }
              />

              <TextField
                label="Categories (comma separated)"
                value={form.licence_categories}
                onChange={(value) =>
                  updateForm("licence_categories", value)
                }
                placeholder="B, C, C+E"
              />

              <TextField
                label="Points"
                value={form.points_total}
                onChange={(value) =>
                  updateForm("points_total", value)
                }
                type="number"
              />

              <SelectField
                label="Licence Status"
                value={form.licence_status}
                onChange={(value) =>
                  updateForm("licence_status", value)
                }
                options={[
                  ["valid", "Valid"],
                  ["expired", "Expired"],
                  ["suspended", "Suspended"],
                  ["revoked", "Revoked"],
                ]}
              />
            </div>

            <CheckboxField
              label="Driver is disqualified"
              checked={form.disqualified}
              onChange={(value) =>
                updateForm("disqualified", value)
              }
            />
          </Section>

          <Section title="Tachograph">
            <CheckboxField
              label="Tachograph required"
              checked={form.tachograph_required}
              onChange={(value) =>
                updateForm("tachograph_required", value)
              }
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Tacho Card Number"
                value={form.tachograph_card_number}
                onChange={(value) =>
                  updateForm("tachograph_card_number", value)
                }
              />

              <TextField
                label="Card Issue Date"
                value={form.tachograph_issue_date}
                onChange={(value) =>
                  updateForm("tachograph_issue_date", value)
                }
                type="date"
              />

              <TextField
                label="Card Expiry"
                value={form.tachograph_expiry}
                onChange={(value) =>
                  updateForm("tachograph_expiry", value)
                }
                type="date"
              />

              <TextField
                label="Last Tacho Download"
                value={form.tachograph_last_download}
                onChange={(value) =>
                  updateForm("tachograph_last_download", value)
                }
                type="date"
              />

              <TextField
                label="Next Download Due"
                value={form.tachograph_next_download_due}
                onChange={(value) =>
                  updateForm("tachograph_next_download_due", value)
                }
                type="date"
              />
            </div>
          </Section>

          <Section title="CPC & ADR">
            <div className="grid gap-3 sm:grid-cols-2">
              <CheckboxField
                label="CPC Required"
                checked={form.cpc_required}
                onChange={(value) =>
                  updateForm("cpc_required", value)
                }
              />

              <CheckboxField
                label="CPC Qualified"
                checked={form.cpc_qualified}
                onChange={(value) =>
                  updateForm("cpc_qualified", value)
                }
              />

              <TextField
                label="CPC Expiry"
                value={form.cpc_expiry}
                onChange={(value) =>
                  updateForm("cpc_expiry", value)
                }
                type="date"
              />

              <TextField
                label="CPC Training Hours"
                value={form.cpc_training_hours}
                onChange={(value) =>
                  updateForm("cpc_training_hours", value)
                }
                type="number"
              />

              <CheckboxField
                label="ADR Required"
                checked={form.adr_required}
                onChange={(value) =>
                  updateForm("adr_required", value)
                }
              />

              <CheckboxField
                label="ADR Qualified"
                checked={form.adr_qualified}
                onChange={(value) =>
                  updateForm("adr_qualified", value)
                }
              />

              <TextField
                label="ADR Certificate"
                value={form.adr_certificate_number}
                onChange={(value) =>
                  updateForm("adr_certificate_number", value)
                }
              />

              <TextField
                label="ADR Classes"
                value={form.adr_classes}
                onChange={(value) =>
                  updateForm("adr_classes", value)
                }
                placeholder="2, 3, 4.1, 6.1"
              />

              <TextField
                label="ADR Expiry"
                value={form.adr_expiry}
                onChange={(value) =>
                  updateForm("adr_expiry", value)
                }
                type="date"
              />
            </div>
          </Section>

          <Section title="Medical & Right to Work">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Last Medical"
                value={form.last_medical_date}
                onChange={(value) =>
                  updateForm("last_medical_date", value)
                }
                type="date"
              />

              <TextField
                label="Next Medical Due"
                value={form.next_medical_due}
                onChange={(value) =>
                  updateForm("next_medical_due", value)
                }
                type="date"
              />

              <TextField
                label="Right to Work Checked"
                value={form.right_to_work_checked_at}
                onChange={(value) =>
                  updateForm("right_to_work_checked_at", value)
                }
                type="date"
              />

              <TextField
                label="Right to Work Expiry"
                value={form.right_to_work_expiry}
                onChange={(value) =>
                  updateForm("right_to_work_expiry", value)
                }
                type="date"
              />

              <TextField
                label="Right to Work Reference"
                value={form.right_to_work_reference}
                onChange={(value) =>
                  updateForm("right_to_work_reference", value)
                }
              />
            </div>
          </Section>

          <Section title="Emergency Contact & Notes">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Emergency Contact"
                value={form.emergency_contact_name}
                onChange={(value) =>
                  updateForm("emergency_contact_name", value)
                }
              />

              <TextField
                label="Emergency Phone"
                value={form.emergency_contact_phone}
                onChange={(value) =>
                  updateForm("emergency_contact_phone", value)
                }
              />
            </div>

            <textarea
              value={form.notes}
              onChange={(event) =>
                updateForm("notes", event.target.value)
              }
              rows={4}
              placeholder="Driver notes..."
              className="min-h-24 w-full resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-3"
            />
          </Section>

          <Button
            type="submit"
            disabled={saving}
            className="mt-4"
          >
            {saving
              ? "Saving..."
              : editingId
                ? "Update Driver"
                : "Add Driver"}
          </Button>
        </form>

        <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-md font-semibold text-ink">Driver Records</h2>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search drivers..."
              className="h-10 w-72 max-w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            />
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-ink-3">Loading drivers...</div>
          ) : (
            <div className="mt-4 grid gap-3 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
              {filteredDrivers.map((driver) => {
                const warnings = getDriverWarnings(driver);

                const assignment = assignments.find(
                  (item) => item.driver_id === driver.id
                );

                const vehicle = vehicles.find(
                  (item) => item.id === assignment?.vehicle_id
                );

                return (
                  <article
                    key={driver.id}
                    className={
                      selectedDriverId === driver.id
                        ? "cursor-pointer rounded-lg border border-primary bg-primary-tint p-3"
                        : "cursor-pointer rounded-lg border border-line bg-surface-2 p-3"
                    }
                    onClick={() => setSelectedDriverId(driver.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-base font-semibold text-ink">
                          {driver.name}
                        </h3>

                        <span className="text-xs text-ink-2">
                          {driver.employee_number || driver.driver_type || ""}
                        </span>
                      </div>

                      <Badge
                        tone={driver.active ? "success" : "neutral"}
                      >
                        {driver.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <div className="my-4 grid grid-cols-3 gap-2.5">
                      <Info label="Licence" value={driver.licence_number} />
                      <Info
                        label="Points"
                        value={String(driver.points_total ?? 0)}
                      />
                      <Info
                        label="Vehicle"
                        value={vehicle?.registration ?? "Unassigned"}
                      />
                    </div>

                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {warnings.length === 0 ? (
                        <Badge tone="success">
                          ✓ Compliance current
                        </Badge>
                      ) : (
                        warnings.map((warning) => (
                          <Badge
                            key={warning}
                            tone="warning"
                          >
                            ⚠ {warning}
                          </Badge>
                        ))
                      )}
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        editDriver(driver);
                      }}
                    >
                      Edit Driver
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedDriver ? (
          <>
            <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="text-md font-semibold text-ink">
                {selectedDriver.name} — Vehicle Assignment
              </h2>

              {selectedVehicle ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success-border bg-success-tint p-4">
                  <div className="min-w-0">
                    <span className="text-sm text-success-strong">Current Vehicle</span>
                    <strong className="mt-1 block break-words text-lg font-semibold text-ink">
                      {selectedVehicle.registration}
                    </strong>
                  </div>

                  <Button
                    variant="danger"
                    onClick={() =>
                      void unassignVehicle(selectedVehicle.id)
                    }
                  >
                    Unassign
                  </Button>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Assign Vehicle"
                    value={vehicleToAssign}
                    onChange={setVehicleToAssign}
                    options={[
                      ["", "Select vehicle"],
                      ...vehicles
                        .filter(
                          (vehicle) =>
                            vehicle.active !== false &&
                            vehicle.vor !== true
                        )
                        .map(
                          (vehicle) =>
                            [
                              vehicle.id,
                              `${vehicle.registration ?? "Vehicle"} ${
                                vehicle.make ?? ""
                              } ${vehicle.model ?? ""}`,
                            ] as [string, string]
                        ),
                    ]}
                  />

                  <TextField
                    label="Assignment Notes"
                    value={assignmentNotes}
                    onChange={setAssignmentNotes}
                  />

                  <Button
                    disabled={assignmentSaving}
                    onClick={() => {
                      console.log(
                        "[vehicle-assignment] Assign Vehicle button onClick fired"
                      );
                      setAssignmentDebug(
                        "BUTTON onClick FIRED — entering assignment handler..."
                      );
                      void assignVehicle();
                    }}
                    className="self-end"
                  >
                    {assignmentSaving
                      ? "Assigning..."
                      : "Assign Vehicle"}
                  </Button>

                  <pre className="m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-2 sm:col-span-2">
                    {assignmentDebug}
                  </pre>
                </div>
              )}
            </section>

            <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-md font-semibold text-ink">Licence Checks</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Check Code"
                  value={checkCode}
                  onChange={setCheckCode}
                />

                <TextField
                  label="Notes"
                  value={checkNotes}
                  onChange={setCheckNotes}
                />

                <Button
                  onClick={() =>
                    void recordLicenceCheck(selectedDriver)
                  }
                  className="self-end"
                >
                  Record Licence Check
                </Button>
              </div>

              <div className="mt-4 grid gap-2">
                {selectedChecks.map((check) => (
                  <div
                    key={check.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <strong className="text-sm font-semibold text-ink">
                      Checked {formatDate(check.checked_at)}
                    </strong>

                    <span className="text-sm text-ink-2">
                      Points: {check.points_total} • Next due:{" "}
                      {formatDate(check.next_check_due)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-md font-semibold text-ink">
                Licence Endorsements / Points
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Code"
                  value={endorsementCode}
                  onChange={setEndorsementCode}
                  placeholder="SP30"
                />

                <TextField
                  label="Points"
                  value={endorsementPoints}
                  onChange={setEndorsementPoints}
                  type="number"
                />

                <TextField
                  label="Description"
                  value={endorsementDescription}
                  onChange={setEndorsementDescription}
                />

                <TextField
                  label="Expiry"
                  value={endorsementExpiry}
                  onChange={setEndorsementExpiry}
                  type="date"
                />

                <Button
                  onClick={() => void addEndorsement()}
                  className="self-end"
                >
                  Add Endorsement
                </Button>
              </div>

              <div className="mt-4 grid gap-2">
                {selectedEndorsements.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="min-w-0">
                      <strong className="break-words text-sm font-semibold text-ink">
                        {item.code} — {item.points} points
                      </strong>

                      <div className="text-xs text-ink-3">
                        {item.description || "No description"}
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        void deleteEndorsement(item)
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-md font-semibold text-ink">
                Training & Qualifications
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Training Type"
                  value={trainingType}
                  onChange={setTrainingType}
                  placeholder="CPC / ADR / HIAB"
                />

                <TextField
                  label="Course"
                  value={trainingCourse}
                  onChange={setTrainingCourse}
                />

                <TextField
                  label="Provider"
                  value={trainingProvider}
                  onChange={setTrainingProvider}
                />

                <TextField
                  label="Hours"
                  value={trainingHours}
                  onChange={setTrainingHours}
                  type="number"
                />

                <TextField
                  label="Expiry"
                  value={trainingExpiry}
                  onChange={setTrainingExpiry}
                  type="date"
                />

                <Button
                  onClick={() => void addTraining()}
                  className="self-end"
                >
                  Add Training
                </Button>
              </div>

              <div className="mt-4 grid gap-2">
                {selectedTraining.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="min-w-0">
                      <strong className="break-words text-sm font-semibold text-ink">{item.training_type}</strong>
                      <div className="text-xs text-ink-3">
                        {item.course_name || ""}
                        {item.provider
                          ? ` • ${item.provider}`
                          : ""}
                      </div>
                    </div>

                    <span className="text-sm text-ink-2">
                      {item.expiry_date
                        ? `Expires ${formatDate(item.expiry_date)}`
                        : "No expiry"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
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
    <section className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
      <h3 className="mb-3 text-md font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>

      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
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
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
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
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="my-2 flex items-center gap-2 text-sm font-semibold text-ink">
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
    <div className="min-w-0">
      <span className="block text-kicker uppercase text-ink-2">{label}</span>
      <strong className="mt-1 block break-words text-sm font-semibold text-ink">{value || "—"}</strong>
    </div>
  );
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addMonths(date: string, months: number): string {
  const result = new Date(`${date}T00:00:00`);
  result.setMonth(result.getMonth() + months);
  return result.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");
}

function getDriverWarnings(driver: Driver): string[] {
  const warnings: string[] = [];

  checkDateWarning(driver.licence_expiry, "Licence", warnings);
  checkDateWarning(driver.licence_check_due, "Licence check", warnings);

  if (driver.tachograph_required) {
    checkDateWarning(
      driver.tachograph_expiry,
      "Tacho card",
      warnings
    );

    checkDateWarning(
      driver.tachograph_next_download_due,
      "Tacho download",
      warnings
    );
  }

  if (driver.cpc_required) {
    if (!driver.cpc_qualified) {
      warnings.push("CPC not qualified");
    }

    checkDateWarning(driver.cpc_expiry, "CPC", warnings);
  }

  if (driver.adr_required) {
    if (!driver.adr_qualified) {
      warnings.push("ADR qualification required");
    }

    checkDateWarning(driver.adr_expiry, "ADR", warnings);
  }

  checkDateWarning(driver.next_medical_due, "Medical", warnings);

  checkDateWarning(
    driver.right_to_work_expiry,
    "Right to work",
    warnings
  );

  if ((driver.points_total ?? 0) >= 6) {
    warnings.push(`${driver.points_total} licence points`);
  }

  if (driver.disqualified) {
    warnings.push("Driver disqualified");
  }

  return warnings;
}

function checkDateWarning(
  date: string | null,
  label: string,
  warnings: string[]
) {
  if (!date) {
    return;
  }

  const today = new Date();
  const target = new Date(`${date}T23:59:59`);
  const days = Math.ceil(
    (target.getTime() - today.getTime()) /
      (1000 * 60 * 60 * 24)
  );

  const formattedDate = formatDate(date);

  if (days < 0) {
    warnings.push(`${label} overdue — ${formattedDate}`);
  } else if (days <= 30) {
    warnings.push(
      `${label} due in ${days} days — ${formattedDate}`
    );
  }
}
