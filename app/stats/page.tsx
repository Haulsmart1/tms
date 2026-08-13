"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createClient } from "../../lib/supabase/browser";

const DAILY_DRIVING_LIMIT_MINUTES = 540;
const SPEED_ALERT_THRESHOLD = 90;

const PERIODS = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

const VIOLATION_PATTERNS = [
  "harsh",
  "brak",
  "speed",
  "violat",
  "infring",
];

type PeriodKey = (typeof PERIODS)[number]["key"];

type Job = {
  id: string;
  tenant_id: string;
  reference: string | null;
  customer_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  subcontractor_id: string | null;
  status: string | null;
  scheduled_date: string | null;
  job_date: string | null;
  customer_price: number | null;
  subcontractor_cost: number | null;
  created_at: string | null;
};

type JobStop = {
  id: string;
  tenant_id: string;
  job_id: string;
  type: string | null;
  status: string | null;
  pod_status: string | null;
  delivered_at: string | null;
};

type Invoice = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  status: string | null;
  issue_date: string | null;
  due_date: string | null;
  total: number | null;
  created_at: string | null;
};

type Vehicle = {
  id: string;
  tenant_id: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  active: boolean | null;
  billable: boolean | null;
  vehicle_type: string | null;
};

type Driver = {
  id: string;
  tenant_id: string;
  name: string | null;
  active: boolean | null;
};

type Customer = {
  id: string;
  tenant_id: string;
  name: string | null;
  active: boolean | null;
  created_at: string | null;
};

type VehicleLicence = {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  active: boolean | null;
  expiry_date: string | null;
};

type VehicleLocation = {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  speed: number | null;
  recorded_at: string | null;
};

type ActivityLog = {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  activity_type: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
};

type LeaderboardRow = {
  id: string;
  name: string;
  jobs: number;
  completed: number;
  revenue: number;
};

function formatMoney(value: unknown): string {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return "£0.00";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(numberValue);
}

function getPeriodStart(period: PeriodKey): Date | null {
  const now = new Date();

  switch (period) {
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);

    case "quarter":
      return new Date(now.getFullYear(), now.getMonth() - 2, 1);

    case "year":
      return new Date(now.getFullYear(), 0, 1);

    case "all":
      return null;

    default:
      return null;
  }
}

function isInPeriod(
  value: string | null | undefined,
  start: Date | null
): boolean {
  if (!start) {
    return true;
  }

  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date >= start;
}

function isCompletedStatus(status: string | null): boolean {
  return status === "completed" || status === "delivered";
}

function isViolationType(activityType: string | null): boolean {
  const value = String(activityType ?? "").toLowerCase();

  return VIOLATION_PATTERNS.some((pattern) => value.includes(pattern));
}

function buildLeaderboard(
  jobs: Job[],
  people: Array<{ id: string; name: string | null }>,
  field: "driver_id" | "customer_id"
): LeaderboardRow[] {
  const names = new Map(
    people.map((person) => [
      person.id,
      person.name?.trim() || "Unknown",
    ])
  );

  const rows = new Map<string, LeaderboardRow>();

  for (const job of jobs) {
    const id = job[field];

    if (!id) {
      continue;
    }

    const existing = rows.get(id) ?? {
      id,
      name: names.get(id) ?? "Unknown",
      jobs: 0,
      completed: 0,
      revenue: 0,
    };

    existing.jobs += 1;

    if (isCompletedStatus(job.status)) {
      existing.completed += 1;
    }

    existing.revenue += Number(job.customer_price ?? 0);

    rows.set(id, existing);
  }

  return Array.from(rows.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

export default function StatsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tenantId, setTenantId] = useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobStops, setJobStops] = useState<JobStop[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [licences, setLicences] = useState<VehicleLicence[]>([]);
  const [vehicleLocations, setVehicleLocations] = useState<
    VehicleLocation[]
  >([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const resolveTenant = useCallback(async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      throw new Error(`Authentication error: ${authError.message}`);
    }

    if (!user) {
      window.location.href = "/";
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw new Error(`Profile error: ${profileError.message}`);
    }

    if (!profile?.tenant_id) {
      throw new Error(
        "Your account does not have a tenant_id assigned in profiles."
      );
    }

    return profile.tenant_id as string;
  }, [supabase]);

  const loadStats = useCallback(
    async (resolvedTenantId: string) => {
      setLoading(true);
      setMessage("");

      try {
        const [
          jobsResult,
          stopsResult,
          invoicesResult,
          vehiclesResult,
          driversResult,
          customersResult,
          licencesResult,
          locationsResult,
          activityResult,
        ] = await Promise.all([
          supabase
            .from("jobs")
            .select(
              `
              id,
              tenant_id,
              reference,
              customer_id,
              driver_id,
              vehicle_id,
              subcontractor_id,
              status,
              scheduled_date,
              job_date,
              customer_price,
              subcontractor_cost,
              created_at
              `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("job_stops")
            .select(
              `
              id,
              tenant_id,
              job_id,
              type,
              status,
              pod_status,
              delivered_at
              `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("invoices")
            .select(
              `
              id,
              tenant_id,
              customer_id,
              status,
              issue_date,
              due_date,
              total,
              created_at
              `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("vehicles")
            .select(
              `
              id,
              tenant_id,
              registration,
              make,
              model,
              year,
              active,
              billable,
              vehicle_type
              `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("registration", { ascending: true }),

          supabase
            .from("drivers")
            .select(
              `
              id,
              tenant_id,
              name,
              active
              `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("name", { ascending: true }),

          supabase
            .from("customers")
            .select(
              `
              id,
              tenant_id,
              name,
              active,
              created_at
              `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("name", { ascending: true }),

          supabase
            .from("vehicle_licences")
            .select(
              `
              id,
              tenant_id,
              vehicle_id,
              active,
              expiry_date
              `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("vehicle_locations")
            .select(
              `
              id,
              tenant_id,
              vehicle_id,
              speed,
              recorded_at
              `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("recorded_at", { ascending: false })
            .limit(2000),

          supabase
            .from("driver_activity_logs")
            .select(
              `
              id,
              tenant_id,
              driver_id,
              vehicle_id,
              activity_type,
              start_time,
              end_time,
              duration_minutes
              `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("start_time", { ascending: false })
            .limit(2000),
        ]);

        const results = [
          ["Jobs", jobsResult.error],
          ["Job stops", stopsResult.error],
          ["Invoices", invoicesResult.error],
          ["Vehicles", vehiclesResult.error],
          ["Drivers", driversResult.error],
          ["Customers", customersResult.error],
          ["Vehicle licences", licencesResult.error],
          ["Vehicle locations", locationsResult.error],
          ["Driver activity", activityResult.error],
        ] as const;

        const failedResult = results.find(([, error]) => error);

        if (failedResult) {
          const [label, error] = failedResult;

          throw new Error(
            `${label} failed to load: ${error?.message ?? "Unknown error"}`
          );
        }

        setJobs((jobsResult.data ?? []) as Job[]);
        setJobStops((stopsResult.data ?? []) as JobStop[]);
        setInvoices((invoicesResult.data ?? []) as Invoice[]);
        setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
        setDrivers((driversResult.data ?? []) as Driver[]);
        setCustomers((customersResult.data ?? []) as Customer[]);
        setLicences((licencesResult.data ?? []) as VehicleLicence[]);
        setVehicleLocations(
          (locationsResult.data ?? []) as VehicleLocation[]
        );
        setActivityLogs((activityResult.data ?? []) as ActivityLog[]);

        console.log("Stats tenant:", resolvedTenantId);
        console.log("Stats vehicles returned:", vehiclesResult.data);
        console.log(
          "Stats active vehicles:",
          (vehiclesResult.data ?? []).filter(
            (vehicle: Vehicle) => vehicle.active === true
          ).length
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load company statistics."
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
        const resolvedTenantId = await resolveTenant();

        if (!resolvedTenantId) {
          return;
        }

        setTenantId(resolvedTenantId);
        await loadStats(resolvedTenantId);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialise statistics."
        );
        setLoading(false);
      }
    }

    void initialise();
  }, [resolveTenant, loadStats]);

  const periodStart = getPeriodStart(period);

  const periodJobs = useMemo(
    () =>
      jobs.filter((job) =>
        isInPeriod(
          job.job_date ?? job.scheduled_date ?? job.created_at,
          periodStart
        )
      ),
    [jobs, periodStart]
  );

  const periodInvoices = useMemo(
    () =>
      invoices.filter((invoice) =>
        isInPeriod(invoice.issue_date ?? invoice.created_at, periodStart)
      ),
    [invoices, periodStart]
  );

  const periodActivityLogs = useMemo(
    () =>
      activityLogs.filter((log) =>
        isInPeriod(log.start_time, periodStart)
      ),
    [activityLogs, periodStart]
  );

  const periodLocations = useMemo(
    () =>
      vehicleLocations.filter((location) =>
        isInPeriod(location.recorded_at, periodStart)
      ),
    [vehicleLocations, periodStart]
  );

  const periodJobIds = useMemo(
    () => new Set(periodJobs.map((job) => job.id)),
    [periodJobs]
  );

  const periodStops = useMemo(
    () =>
      jobStops.filter((stop) => periodJobIds.has(stop.job_id)),
    [jobStops, periodJobIds]
  );

  const deliveryStops = periodStops.filter(
    (stop) => String(stop.type ?? "").toLowerCase() === "delivery"
  );

  const deliveredStops = deliveryStops.filter(
    (stop) =>
      stop.status === "delivered" ||
      stop.pod_status === "delivered" ||
      Boolean(stop.delivered_at)
  );

  const pendingPods = Math.max(
    deliveryStops.length - deliveredStops.length,
    0
  );

  const podRate =
    deliveryStops.length > 0
      ? Math.round(
          (deliveredStops.length / deliveryStops.length) * 100
        )
      : 0;

  const completedJobs = periodJobs.filter((job) =>
    isCompletedStatus(job.status)
  );

  const plannedJobs = periodJobs.filter((job) =>
    ["draft", "booked", "planned", "allocated"].includes(
      String(job.status ?? "")
    )
  );

  const revenue = periodJobs.reduce(
    (total, job) => total + Number(job.customer_price ?? 0),
    0
  );

  const subcontractorCost = periodJobs.reduce(
    (total, job) => total + Number(job.subcontractor_cost ?? 0),
    0
  );

  const grossMargin = revenue - subcontractorCost;

  const marginPercent =
    revenue > 0 ? (grossMargin / revenue) * 100 : 0;

  const subcontractedJobs = periodJobs.filter(
    (job) => Boolean(job.subcontractor_id)
  ).length;

  const ownFleetJobs = periodJobs.length - subcontractedJobs;

  const invoicedTotal = periodInvoices.reduce(
    (total, invoice) => total + Number(invoice.total ?? 0),
    0
  );

  const draftInvoices = periodInvoices.filter(
    (invoice) => invoice.status === "draft"
  ).length;

  const sentInvoices = periodInvoices.filter(
    (invoice) => invoice.status === "sent"
  ).length;

  const paidInvoices = periodInvoices.filter(
    (invoice) => invoice.status === "paid"
  ).length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueInvoices = invoices.filter((invoice) => {
    if (!invoice.due_date) {
      return false;
    }

    if (invoice.status === "paid" || invoice.status === "draft") {
      return false;
    }

    const dueDate = new Date(`${invoice.due_date}T00:00:00`);

    return dueDate < today;
  });

  const overdueValue = overdueInvoices.reduce(
    (total, invoice) => total + Number(invoice.total ?? 0),
    0
  );

  const newCustomers = customers.filter((customer) =>
    isInPeriod(customer.created_at, periodStart)
  ).length;

  const drivingLogs = periodActivityLogs.filter((log) => {
    const activity = String(log.activity_type ?? "").toLowerCase();

    return activity.includes("driv") && !isViolationType(activity);
  });

  const totalDrivingMinutes = drivingLogs.reduce(
    (total, log) => total + Number(log.duration_minutes ?? 0),
    0
  );

  const drivingHours = totalDrivingMinutes / 60;

  const driverDayMinutes = new Map<string, number>();

  for (const log of drivingLogs) {
    if (!log.driver_id || !log.start_time) {
      continue;
    }

    const date = new Date(log.start_time);

    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = [
      log.driver_id,
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
    ].join("-");

    driverDayMinutes.set(
      key,
      (driverDayMinutes.get(key) ?? 0) +
        Number(log.duration_minutes ?? 0)
    );
  }

  let drivingHoursAlerts = 0;

  for (const minutes of driverDayMinutes.values()) {
    if (minutes > DAILY_DRIVING_LIMIT_MINUTES) {
      drivingHoursAlerts += 1;
    }
  }

  const violationEvents = periodActivityLogs.filter((log) =>
    isViolationType(log.activity_type)
  ).length;

  const speedAlerts = periodLocations.filter(
    (location) =>
      Number(location.speed ?? 0) > SPEED_ALERT_THRESHOLD
  ).length;

  /*
   * Fleet calculations
   * Your database has already confirmed 4 rows for ADR Carriers.
   */
  const totalVehicles = vehicles.length;

  const activeVehicles = vehicles.filter(
    (vehicle) => vehicle.active === true
  ).length;

  const inactiveVehicles = vehicles.filter(
    (vehicle) => vehicle.active !== true
  ).length;

  const billableVehicles = vehicles.filter(
    (vehicle) =>
      vehicle.active === true && vehicle.billable === true
  ).length;

  const activeDrivers = drivers.filter(
    (driver) => driver.active === true
  ).length;

  const thirtyDaysAhead = new Date(today);
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

  const licencesExpiringSoon = licences.filter((licence) => {
    if (licence.active !== true || !licence.expiry_date) {
      return false;
    }

    const expiry = new Date(`${licence.expiry_date}T00:00:00`);

    return expiry >= today && expiry <= thirtyDaysAhead;
  }).length;

  const driverLeaderboard = useMemo(
    () =>
      buildLeaderboard(
        periodJobs.filter(
          (job) => Boolean(job.driver_id) && !job.subcontractor_id
        ),
        drivers,
        "driver_id"
      ),
    [periodJobs, drivers]
  );

  const customerLeaderboard = useMemo(
    () =>
      buildLeaderboard(
        periodJobs.filter((job) => Boolean(job.customer_id)),
        customers,
        "customer_id"
      ),
    [periodJobs, customers]
  );

  async function refresh() {
    if (!tenantId) {
      return;
    }

    await loadStats(tenantId);
  }

  return (
    <main style={styles.page}>
      <div style={styles.overlay}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Insights</p>
            <h1 style={styles.title}>Company Stats</h1>
            <p style={styles.subtitle}>
              Jobs, revenue, POD, invoicing, fleet and driver
              performance.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            style={styles.refreshButton}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </header>

        {message ? (
          <div style={styles.errorBox}>
            <strong>Unable to load statistics</strong>
            <div style={{ marginTop: 5 }}>{message}</div>
          </div>
        ) : null}

        <div style={styles.periodBar}>
          {PERIODS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPeriod(option.key)}
              style={
                period === option.key
                  ? styles.periodButtonActive
                  : styles.periodButton
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={styles.loading}>Loading statistics...</div>
        ) : (
          <>
            <SectionTitle>Jobs & revenue</SectionTitle>

            <div style={styles.grid}>
              <StatCard
                icon="📦"
                value={periodJobs.length}
                title="Total jobs"
                caption="Jobs in this period"
              />

              <StatCard
                icon="✅"
                value={completedJobs.length}
                title="Completed"
                caption="Delivered or completed"
              />

              <StatCard
                icon="🗓️"
                value={plannedJobs.length}
                title="Planned"
                caption="Draft, booked, planned or allocated"
              />

              <StatCard
                icon="💷"
                value={formatMoney(revenue)}
                title="Revenue"
                caption="Customer job revenue"
              />

              <StatCard
                icon="🧾"
                value={formatMoney(subcontractorCost)}
                title="Subcontractor cost"
                caption="External haulage costs"
              />

              <StatCard
                icon="📈"
                value={formatMoney(grossMargin)}
                title="Gross margin"
                caption={`${marginPercent.toFixed(1)}% margin`}
              />

              <StatCard
                icon="🚛"
                value={`${ownFleetJobs} / ${subcontractedJobs}`}
                title="Own fleet / subbed"
                caption="In-house vs subcontracted"
              />
            </div>

            <SectionTitle>Delivery & POD</SectionTitle>

            <div style={styles.grid}>
              <StatCard
                icon="📍"
                value={`${deliveredStops.length} / ${deliveryStops.length}`}
                title="Stops delivered"
                caption="Delivered vs delivery stops"
              />

              <StatCard
                icon="📸"
                value={
                  deliveryStops.length > 0 ? `${podRate}%` : "—"
                }
                title="POD rate"
                caption="Delivery POD completion"
              />

              <StatCard
                icon="⏳"
                value={pendingPods}
                title="PODs pending"
                caption="Delivery stops awaiting POD"
              />
            </div>

            <SectionTitle>Invoicing</SectionTitle>

            <div style={styles.grid}>
              <StatCard
                icon="💷"
                value={formatMoney(invoicedTotal)}
                title="Invoiced total"
                caption="Invoices issued in this period"
              />

              <StatCard
                icon="📤"
                value={`${draftInvoices} / ${sentInvoices} / ${paidInvoices}`}
                title="Draft / sent / paid"
                caption="Invoice pipeline"
              />

              <StatCard
                icon="⚠️"
                value={overdueInvoices.length}
                title="Overdue invoices"
                caption="Past due and unpaid"
              />

              <StatCard
                icon="💸"
                value={formatMoney(overdueValue)}
                title="Overdue value"
                caption="Outstanding past due"
              />
            </div>

            <SectionTitle>Growth & compliance</SectionTitle>

            <div style={styles.grid}>
              <StatCard
                icon="🆕"
                value={newCustomers}
                title="New customers"
                caption="Added in this period"
              />

              <StatCard
                icon="⏱️"
                value={drivingHoursAlerts}
                title="Drivers' hours alerts"
                caption="Driver-days over 9 hours"
              />

              <StatCard
                icon="🚨"
                value={violationEvents}
                title="Violation events"
                caption="Compliance activity events"
              />

              <StatCard
                icon="📡"
                value={speedAlerts}
                title="Speed alerts"
                caption={`Readings over ${SPEED_ALERT_THRESHOLD} km/h`}
              />

              <StatCard
                icon="🕒"
                value={`${drivingHours.toFixed(1)} h`}
                title="Driving hours logged"
                caption="Driving time in this period"
              />
            </div>

            <SectionTitle>Fleet — right now</SectionTitle>

            <p style={styles.sectionCaption}>
              Snapshot figures — not affected by the period selector.
            </p>

            <div style={styles.grid}>
              <StatCard
                icon="🚛"
                value={`${activeVehicles} / ${totalVehicles}`}
                title="Active vehicles"
                caption="Active vs total fleet"
              />

              <StatCard
                icon="💼"
                value={billableVehicles}
                title="Billable vehicles"
                caption="Active and billable"
              />

              <StatCard
                icon="🛠️"
                value={inactiveVehicles}
                title="Vehicles off road"
                caption="Inactive / VOR"
              />

              <StatCard
                icon="🧑‍✈️"
                value={`${activeDrivers} / ${drivers.length}`}
                title="Active drivers"
                caption="Active vs total drivers"
              />

              <StatCard
                icon="📄"
                value={licencesExpiringSoon}
                title="Licences expiring"
                caption="Within the next 30 days"
              />
            </div>

            <SectionTitle>Fleet detail</SectionTitle>

            <div style={styles.tableCard}>
              {vehicles.length === 0 ? (
                <p style={styles.emptyText}>
                  No vehicles returned for tenant {tenantId ?? "unknown"}.
                </p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Registration</th>
                      <th style={styles.th}>Vehicle</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Active</th>
                      <th style={styles.th}>Billable</th>
                    </tr>
                  </thead>

                  <tbody>
                    {vehicles.map((vehicle) => (
                      <tr key={vehicle.id}>
                        <td style={styles.td}>
                          <strong>
                            {vehicle.registration ?? "—"}
                          </strong>
                        </td>

                        <td style={styles.td}>
                          {[vehicle.make, vehicle.model]
                            .filter(Boolean)
                            .join(" ") || "—"}
                        </td>

                        <td style={styles.td}>
                          {vehicle.vehicle_type ?? "—"}
                        </td>

                        <td style={styles.td}>
                          {vehicle.active ? "Yes" : "No"}
                        </td>

                        <td style={styles.td}>
                          {vehicle.billable ? "Yes" : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <SectionTitle>Driver leaderboard</SectionTitle>

            <LeaderboardTable
              rows={driverLeaderboard}
              firstColumn="Driver"
              emptyText="No jobs with assigned drivers in this period."
            />

            <SectionTitle>Top customers</SectionTitle>

            <LeaderboardTable
              rows={customerLeaderboard}
              firstColumn="Customer"
              emptyText="No customer jobs in this period."
            />

            <div style={styles.debugBox}>
              <strong>Stats diagnostic</strong>

              <div>Tenant: {tenantId ?? "not resolved"}</div>
              <div>Vehicles returned: {vehicles.length}</div>
              <div>Active vehicles: {activeVehicles}</div>
              <div>Drivers returned: {drivers.length}</div>
              <div>Customers returned: {customers.length}</div>
              <div>Jobs returned: {jobs.length}</div>
              <div>Invoices returned: {invoices.length}</div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return <h2 style={styles.sectionTitle}>{children}</h2>;
}

function StatCard({
  icon,
  value,
  title,
  caption,
}: {
  icon: string;
  value: string | number;
  title: string;
  caption: string;
}) {
  return (
    <article style={styles.statCard}>
      <div style={styles.icon}>{icon}</div>

      <div style={styles.statValue}>{value}</div>

      <div style={styles.statTitle}>{title}</div>

      <div style={styles.statCaption}>{caption}</div>
    </article>
  );
}

function LeaderboardTable({
  rows,
  firstColumn,
  emptyText,
}: {
  rows: LeaderboardRow[];
  firstColumn: string;
  emptyText: string;
}) {
  return (
    <div style={styles.tableCard}>
      {rows.length === 0 ? (
        <p style={styles.emptyText}>{emptyText}</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{firstColumn}</th>
              <th style={styles.th}>Jobs</th>
              <th style={styles.th}>Completed</th>
              <th style={styles.th}>Revenue</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={styles.td}>{row.name}</td>
                <td style={styles.td}>{row.jobs}</td>
                <td style={styles.td}>{row.completed}</td>
                <td style={styles.td}>
                  {formatMoney(row.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "30px",
    backgroundImage:
      "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  },

  overlay: {
    maxWidth: "1500px",
    margin: "0 auto",
    padding: "30px",
    borderRadius: "20px",
    background: "rgba(5, 15, 30, 0.72)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "20px",
    flexWrap: "wrap",
    marginBottom: "24px",
    color: "#ffffff",
  },

  eyebrow: {
    margin: "0 0 5px",
    color: "#93c5fd",
    fontSize: "12px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  title: {
    margin: 0,
    fontSize: "38px",
  },

  subtitle: {
    margin: "7px 0 0",
    color: "rgba(255,255,255,0.82)",
  },

  refreshButton: {
    padding: "11px 16px",
    border: "1px solid rgba(255,255,255,0.5)",
    borderRadius: "10px",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 800,
    cursor: "pointer",
  },

  errorBox: {
    padding: "14px",
    marginBottom: "20px",
    border: "1px solid #fecaca",
    borderRadius: "12px",
    background: "#fee2e2",
    color: "#991b1b",
  },

  periodBar: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "26px",
  },

  periodButton: {
    padding: "10px 14px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 700,
    cursor: "pointer",
  },

  periodButtonActive: {
    padding: "10px 14px",
    border: "1px solid #2563eb",
    borderRadius: "10px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },

  loading: {
    padding: "60px 20px",
    textAlign: "center",
    color: "#ffffff",
    fontSize: "18px",
  },

  sectionTitle: {
    margin: "28px 0 14px",
    color: "#ffffff",
    fontSize: "23px",
  },

  sectionCaption: {
    margin: "-8px 0 16px",
    color: "rgba(255,255,255,0.82)",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "18px",
    marginBottom: "28px",
  },

  statCard: {
    padding: "20px",
    borderRadius: "15px",
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.24)",
  },

  icon: {
    marginBottom: "9px",
    fontSize: "27px",
  },

  statValue: {
    marginBottom: "3px",
    color: "#0f172a",
    fontSize: "24px",
    fontWeight: 900,
  },

  statTitle: {
    color: "#0f172a",
    fontWeight: 800,
  },

  statCaption: {
    marginTop: "2px",
    color: "#64748b",
    fontSize: "13px",
  },

  tableCard: {
    marginBottom: "28px",
    padding: "20px",
    overflowX: "auto",
    borderRadius: "15px",
    background: "rgba(255,255,255,0.96)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.20)",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
  },

  th: {
    padding: "11px",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    color: "#475569",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },

  td: {
    padding: "12px 11px",
    borderBottom: "1px solid #f1f5f9",
    color: "#0f172a",
  },

  emptyText: {
    margin: 0,
    color: "#64748b",
  },

  debugBox: {
    marginTop: "30px",
    padding: "15px",
    borderRadius: "12px",
    background: "rgba(219,234,254,0.96)",
    color: "#1e3a8a",
    fontSize: "13px",
    lineHeight: 1.7,
  },
};