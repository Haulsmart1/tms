"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import { applyTenantFilter } from "../../lib/tenant/filter";

const DAILY_DRIVING_LIMIT_MINUTES = 540;
const SPEED_ALERT_THRESHOLD = 90;

const VIOLATION_PATTERNS = [
  "harsh",
  "brak",
  "speed",
  "violat",
  "infring",
];

const PERIODS = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

type Job = {
  id: string;
  tenant_id: string;
  reference: string | null;
  status: string | null;
  job_date: string | null;
  scheduled_date: string | null;
  customer_price: number | null;
  subcontractor_cost: number | null;
  subcontractor_id: string | null;
  customer_id: string | null;
  driver_id: string | null;
  created_at: string | null;
  customers?: unknown;
  drivers?: unknown;
  job_stops?: JobStop[];
};

type JobStop = {
  id: string;
  type: string | null;
  status: string | null;
  pod_status: string | null;
  delivered_at: string | null;
};

type Invoice = {
  id: string;
  issue_date: string | null;
  due_date: string | null;
  total: number | null;
  status: string | null;
  created_at: string | null;
};

type Vehicle = {
  id: string;
  registration: string | null;
  make: string | null;
  model: string | null;
  active: boolean | null;
  billable: boolean | null;
  vehicle_type: string | null;
};

type Driver = {
  id: string;
  name: string | null;
  active: boolean | null;
};

type Customer = {
  id: string;
  name: string | null;
  active: boolean | null;
  created_at: string | null;
};

type VehicleLicence = {
  id: string;
  active: boolean | null;
  expiry_date: string | null;
};

type ActivityLog = {
  id: string;
  driver_id: string | null;
  tenant_id: string;
  activity_type: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
};

type SpeedReading = {
  id: string;
  speed: number | null;
  recorded_at: string | null;
};

function isViolationType(activityType: unknown): boolean {
  const type = String(activityType ?? "").toLowerCase();

  return VIOLATION_PATTERNS.some((pattern) =>
    type.includes(pattern)
  );
}

function formatMoney(value: unknown): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "£0.00";
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "£0.00";
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function periodStart(period: PeriodKey): Date | null {
  const now = new Date();

  if (period === "month") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );
  }

  if (period === "quarter") {
    return new Date(
      now.getFullYear(),
      now.getMonth() - 2,
      1
    );
  }

  if (period === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }

  return null;
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

function embeddedName(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0]?.name ?? null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "name" in value
  ) {
    const name = (value as { name?: unknown }).name;

    return typeof name === "string" ? name : null;
  }

  return null;
}

function groupJobsBy(
  jobsList: Job[],
  keyField: "driver_id" | "customer_id",
  nameField: "drivers" | "customers"
) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      jobs: number;
      completed: number;
      revenue: number;
    }
  >();

  for (const job of jobsList) {
    const key = job[keyField];

    if (!key) {
      continue;
    }

    const existing =
      groups.get(key) ?? {
        id: key,
        name:
          embeddedName(job[nameField]) ??
          "Unknown",
        jobs: 0,
        completed: 0,
        revenue: 0,
      };

    existing.jobs += 1;

    if (
      job.status === "completed" ||
      job.status === "delivered"
    ) {
      existing.completed += 1;
    }

    existing.revenue +=
      Number(job.customer_price) || 0;

    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
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
    <div style={statCardStyle}>
      <div
        style={{
          fontSize: 28,
          marginBottom: 8,
        }}
        aria-hidden="true"
      >
        {icon}
      </div>

      <h2
        style={{
          margin: 0,
          color: "#0f172a",
        }}
      >
        {value}
      </h2>

      <p
        style={{
          margin: "4px 0 0",
          fontWeight: 700,
          color: "#0f172a",
        }}
      >
        {title}
      </p>

      <p
        style={{
          margin: 0,
          color: "#64748b",
          fontSize: 14,
        }}
      >
        {caption}
      </p>
    </div>
  );
}

export default function StatsPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const tenant = useTenant();

  const [status, setStatus] = useState<
    "loading" | "ready"
  >("loading");

  const [message, setMessage] = useState("");
  const [period, setPeriod] =
    useState<PeriodKey>("month");

  const [resolvedTenantId, setResolvedTenantId] =
    useState<string | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] =
    useState<Invoice[]>([]);
  const [vehicles, setVehicles] =
    useState<Vehicle[]>([]);
  const [drivers, setDrivers] =
    useState<Driver[]>([]);
  const [customers, setCustomers] =
    useState<Customer[]>([]);
  const [licences, setLicences] =
    useState<VehicleLicence[]>([]);
  const [activityLogs, setActivityLogs] =
    useState<ActivityLog[]>([]);
  const [speedReadings, setSpeedReadings] =
    useState<SpeedReading[]>([]);

  const loadStats = useCallback(
    async (tenantId: string | null) => {
      setStatus("loading");
      setMessage("");

      try {
        /*
         * Explicit tenant_id filters are used throughout this
         * reporting page.
         *
         * RLS remains the actual security boundary.
         */
        const [
          jobsRes,
          invoicesRes,
          vehiclesRes,
          driversRes,
          customersRes,
          licencesRes,
          speedRes,
          activityRes,
        ] = await Promise.all([
          applyTenantFilter(
            supabase
              .from("jobs")
              .select(`
                id,
                tenant_id,
                reference,
                status,
                job_date,
                scheduled_date,
                customer_price,
                subcontractor_cost,
                subcontractor_id,
                customer_id,
                driver_id,
                created_at,
                customers ( name ),
                drivers ( name ),
                job_stops (
                  id,
                  type,
                  status,
                  pod_status,
                  delivered_at
                )
              `),
            tenantId,
          ).order("created_at", {
            ascending: false,
          }),

          applyTenantFilter(
            supabase
              .from("invoices")
              .select(`
                id,
                issue_date,
                due_date,
                total,
                status,
                created_at
              `),
            tenantId,
          ).order("created_at", {
            ascending: false,
          }),

          applyTenantFilter(
            supabase
              .from("vehicles")
              .select(`
                id,
                registration,
                make,
                model,
                active,
                billable,
                vehicle_type
              `),
            tenantId,
          ).order("registration", {
            ascending: true,
          }),

          applyTenantFilter(
            supabase
              .from("drivers")
              .select(`
                id,
                name,
                active
              `),
            tenantId,
          ).order("name", {
            ascending: true,
          }),

          applyTenantFilter(
            supabase
              .from("customers")
              .select(`
                id,
                name,
                active,
                created_at
              `),
            tenantId,
          ).order("name", {
            ascending: true,
          }),

          applyTenantFilter(
            supabase
              .from("vehicle_licences")
              .select(`
                id,
                active,
                expiry_date
              `),
            tenantId,
          ),

          applyTenantFilter(
            supabase
              .from("vehicle_locations")
              .select(`
                id,
                speed,
                recorded_at
              `),
            tenantId,
          )
            .gt(
              "speed",
              SPEED_ALERT_THRESHOLD
            )
            .order("recorded_at", {
              ascending: false,
            })
            .limit(1000),

          applyTenantFilter(
            supabase
              .from("driver_activity_logs")
              .select(`
                id,
                tenant_id,
                driver_id,
                activity_type,
                start_time,
                end_time,
                duration_minutes
              `),
            tenantId,
          )
            .order("start_time", {
              ascending: false,
            })
            .limit(1000),
        ]);

        const failures: Array<
          [string, { message: string } | null]
        > = [
          ["Jobs", jobsRes.error],
          ["Invoices", invoicesRes.error],
          ["Vehicles", vehiclesRes.error],
          ["Drivers", driversRes.error],
          ["Customers", customersRes.error],
          ["Licences", licencesRes.error],
          ["Speed readings", speedRes.error],
          [
            "Driver activity",
            activityRes.error,
          ],
        ];

        const failure = failures.find(
          ([, error]) => Boolean(error)
        );

        if (failure) {
          const [label, error] = failure;

          throw new Error(
            `${label} load error: ${
              error?.message ??
              "Unknown Supabase error"
            }`
          );
        }

        setJobs(
          (jobsRes.data ?? []) as Job[]
        );

        setInvoices(
          (invoicesRes.data ?? []) as Invoice[]
        );

        setVehicles(
          (vehiclesRes.data ?? []) as Vehicle[]
        );

        setDrivers(
          (driversRes.data ?? []) as Driver[]
        );

        setCustomers(
          (customersRes.data ??
            []) as Customer[]
        );

        setLicences(
          (licencesRes.data ??
            []) as VehicleLicence[]
        );

        setSpeedReadings(
          (speedRes.data ??
            []) as SpeedReading[]
        );

        setActivityLogs(
          (activityRes.data ??
            []) as ActivityLog[]
        );

        setStatus("ready");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : String(error)
        );

        setStatus("ready");
      }
    },
    [supabase]
  );

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      try {
        // null is a valid state here, not an error: it means no specific
        // tenant is selected (the admin/super_admin "All tenants" view),
        // and loadStats runs every query unfiltered, same as applyTenantFilter
        // does elsewhere in the app — RLS is what actually scopes the rows.
        const tenantId = tenant.activeTenantId;

        if (cancelled) {
          return;
        }

        setResolvedTenantId(tenantId);

        await loadStats(tenantId);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMessage(
          error instanceof Error
            ? error.message
            : String(error)
        );

        setStatus("ready");
      }
    }

    void initialise();

    return () => {
      cancelled = true;
    };
  }, [
    loadStats,
    tenant.activeTenantId,
  ]);

  const start = periodStart(period);

  const now = new Date();

  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  /*
   * New jobs use job_date.
   * Older jobs continue to fall back to scheduled_date.
   */
  const periodJobs = jobs.filter((job) =>
    isInPeriod(
      job.job_date ??
        job.scheduled_date ??
        job.created_at,
      start
    )
  );

  const completedJobs = periodJobs.filter(
    (job) =>
      job.status === "completed" ||
      job.status === "delivered"
  );

  const plannedJobs = periodJobs.filter(
    (job) =>
      job.status === "planned" ||
      job.status === "booked" ||
      job.status === "allocated"
  );

  const revenue = periodJobs.reduce(
    (sum, job) =>
      sum +
      (Number(job.customer_price) || 0),
    0
  );

  const subcontractorCost =
    periodJobs.reduce(
      (sum, job) =>
        sum +
        (Number(
          job.subcontractor_cost
        ) || 0),
      0
    );

  const margin =
    revenue - subcontractorCost;

  const marginPercent =
    revenue > 0
      ? (margin / revenue) * 100
      : 0;

  const subbedJobs =
    periodJobs.filter(
      (job) => job.subcontractor_id
    );

  const ownFleetJobs =
    periodJobs.length -
    subbedJobs.length;

  /*
   * POD metrics only include delivery stops.
   */
  const periodStops =
    periodJobs.flatMap(
      (job) => job.job_stops ?? []
    );

  const deliveryStops =
    periodStops.filter(
      (stop) =>
        String(stop.type).toLowerCase() ===
        "delivery"
    );

  const deliveredStops =
    deliveryStops.filter(
      (stop) =>
        stop.pod_status === "delivered" ||
        stop.status === "delivered"
    );

  const pendingPods =
    deliveryStops.length -
    deliveredStops.length;

  const podRate =
    deliveryStops.length > 0
      ? `${Math.round(
          (deliveredStops.length /
            deliveryStops.length) *
            100
        )}%`
      : "—";

  /*
   * Invoice metrics.
   *
   * IMPORTANT: your actual Supabase column is "total".
   */
  const periodInvoices =
    invoices.filter((invoice) =>
      isInPeriod(
        invoice.issue_date ??
          invoice.created_at,
        start
      )
    );

  const invoicedTotal =
    periodInvoices.reduce(
      (sum, invoice) =>
        sum +
        (Number(invoice.total) || 0),
      0
    );

  const draftCount =
    periodInvoices.filter(
      (invoice) =>
        invoice.status === "draft"
    ).length;

  const sentCount =
    periodInvoices.filter(
      (invoice) =>
        invoice.status === "sent"
    ).length;

  const paidCount =
    periodInvoices.filter(
      (invoice) =>
        invoice.status === "paid"
    ).length;

  const overdueInvoices =
    invoices.filter((invoice) => {
      if (!invoice.due_date) {
        return false;
      }

      if (
        invoice.status === "paid" ||
        invoice.status === "draft"
      ) {
        return false;
      }

      const due = new Date(
        `${invoice.due_date}T00:00:00`
      );

      return due < todayMidnight;
    });

  const overdueValue =
    overdueInvoices.reduce(
      (sum, invoice) =>
        sum +
        (Number(invoice.total) || 0),
      0
    );

  /*
   * Growth.
   */
  const newCustomers =
    customers.filter((customer) =>
      isInPeriod(
        customer.created_at,
        start
      )
    ).length;

  /*
   * Driver hours / compliance.
   */
  const scopedLogs =
    activityLogs.filter((log) =>
      isInPeriod(log.start_time, start)
    );

  const drivingLogs =
    scopedLogs.filter((log) => {
      const type = String(
        log.activity_type ?? ""
      ).toLowerCase();

      return (
        type.includes("driv") &&
        !isViolationType(type)
      );
    });

  const drivingMinutesByDriverDay =
    new Map<string, number>();

  for (const log of drivingLogs) {
    if (
      !log.driver_id ||
      !log.start_time
    ) {
      continue;
    }

    const startedAt = new Date(
      log.start_time
    );

    if (
      Number.isNaN(
        startedAt.getTime()
      )
    ) {
      continue;
    }

    const dayKey =
      `${log.driver_id}|` +
      `${startedAt.getFullYear()}-` +
      `${startedAt.getMonth() + 1}-` +
      `${startedAt.getDate()}`;

    drivingMinutesByDriverDay.set(
      dayKey,
      (drivingMinutesByDriverDay.get(
        dayKey
      ) ?? 0) +
        (Number(
          log.duration_minutes
        ) || 0)
    );
  }

  let hoursAlerts = 0;

  drivingMinutesByDriverDay.forEach(
    (minutes) => {
      if (
        minutes >
        DAILY_DRIVING_LIMIT_MINUTES
      ) {
        hoursAlerts += 1;
      }
    }
  );

  const violationEvents =
    scopedLogs.filter((log) =>
      isViolationType(
        log.activity_type
      )
    ).length;

  const totalDrivingMinutes =
    drivingLogs.reduce(
      (sum, log) =>
        sum +
        (Number(
          log.duration_minutes
        ) || 0),
      0
    );

  const drivingHours =
    totalDrivingMinutes / 60;

  const speedAlerts =
    speedReadings.filter((reading) =>
      isInPeriod(
        reading.recorded_at,
        start
      )
    ).length;

  /*
   * Fleet snapshot.
   *
   * This is the section that was returning 0 / 0.
   * The vehicle query is now explicitly tenant-scoped and
   * only runs after tenantId has been resolved.
   */
  const activeVehicles =
    vehicles.filter(
      (vehicle) =>
        vehicle.active === true
    ).length;

  const billableVehicles =
    vehicles.filter(
      (vehicle) =>
        vehicle.active === true &&
        vehicle.billable === true
    ).length;

  const vehiclesOffRoad =
    vehicles.filter(
      (vehicle) =>
        vehicle.active !== true
    ).length;

  const activeDrivers =
    drivers.filter(
      (driver) =>
        driver.active === true
    ).length;

  const thirtyDaysAhead = new Date(
    todayMidnight.getFullYear(),
    todayMidnight.getMonth(),
    todayMidnight.getDate() + 30
  );

  const licencesExpiringSoon =
    licences.filter((licence) => {
      if (
        licence.active !== true ||
        !licence.expiry_date
      ) {
        return false;
      }

      const expiry = new Date(
        `${licence.expiry_date}T00:00:00`
      );

      return (
        expiry >= todayMidnight &&
        expiry <= thirtyDaysAhead
      );
    }).length;

  const driverLeaderboard =
    groupJobsBy(
      periodJobs.filter(
        (job) =>
          job.driver_id &&
          !job.subcontractor_id
      ),
      "driver_id",
      "drivers"
    );

  const topCustomers =
    groupJobsBy(
      periodJobs,
      "customer_id",
      "customers"
    );

  return (
    <TenantGate>
      <main style={pageStyle}>
        <div style={overlayStyle}>
          <header style={headerStyle}>
            <div>
              <h1 style={titleStyle}>
                Company Stats
              </h1>

              <p style={subtitleStyle}>
                Performance across jobs,
                deliveries, invoicing,
                customers, drivers and fleet.
              </p>

              {resolvedTenantId ? (
                <p style={tenantLabelStyle}>
                  Tenant:{" "}
                  {resolvedTenantId}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              style={refreshButtonStyle}
              disabled={
                status === "loading"
              }
              onClick={() => {
                void loadStats(
                  resolvedTenantId
                );
              }}
            >
              {status === "loading"
                ? "Loading..."
                : "Refresh"}
            </button>
          </header>

          {message ? (
            <div style={messageStyle}>
              <strong>
                Stats error
              </strong>

              <div
                style={{
                  marginTop: 4,
                }}
              >
                {message}
              </div>
            </div>
          ) : null}

          {status === "loading" ? (
            <div style={loadingStyle}>
              Loading statistics...
            </div>
          ) : (
            <>
              <div style={periodBarStyle}>
                {PERIODS.map(
                  (option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={
                        period ===
                        option.key
                      }
                      onClick={() =>
                        setPeriod(
                          option.key
                        )
                      }
                      style={
                        period ===
                        option.key
                          ? periodButtonActiveStyle
                          : periodButtonStyle
                      }
                    >
                      {option.label}
                    </button>
                  )
                )}
              </div>

              <SectionTitle>
                Jobs & revenue
              </SectionTitle>

              <div style={statGridStyle}>
                <StatCard
                  icon="📦"
                  value={
                    periodJobs.length
                  }
                  title="Total jobs"
                  caption="Jobs in this period"
                />

                <StatCard
                  icon="✅"
                  value={
                    completedJobs.length
                  }
                  title="Completed"
                  caption="Delivered or completed jobs"
                />

                <StatCard
                  icon="🗓️"
                  value={
                    plannedJobs.length
                  }
                  title="Planned"
                  caption="Booked, planned or allocated jobs"
                />

                <StatCard
                  icon="💷"
                  value={formatMoney(
                    revenue
                  )}
                  title="Revenue"
                  caption="Customer job value"
                />

                <StatCard
                  icon="🧾"
                  value={formatMoney(
                    subcontractorCost
                  )}
                  title="Subcontractor cost"
                  caption="External haulage cost"
                />

                <StatCard
                  icon="📈"
                  value={formatMoney(
                    margin
                  )}
                  title="Gross margin"
                  caption={`${marginPercent.toFixed(
                    1
                  )}% of revenue`}
                />

                <StatCard
                  icon="🚚"
                  value={`${ownFleetJobs} / ${subbedJobs.length}`}
                  title="Own fleet / subbed"
                  caption="In-house vs subcontracted"
                />
              </div>

              <SectionTitle>
                Delivery & POD
              </SectionTitle>

              <div style={statGridStyle}>
                <StatCard
                  icon="📍"
                  value={`${deliveredStops.length} / ${deliveryStops.length}`}
                  title="Stops delivered"
                  caption="Delivered vs delivery stops"
                />

                <StatCard
                  icon="📸"
                  value={podRate}
                  title="POD rate"
                  caption="Delivery completion rate"
                />

                <StatCard
                  icon="⏳"
                  value={pendingPods}
                  title="PODs pending"
                  caption="Delivery stops awaiting POD"
                />
              </div>

              <SectionTitle>
                Invoicing
              </SectionTitle>

              <div style={statGridStyle}>
                <StatCard
                  icon="💷"
                  value={formatMoney(
                    invoicedTotal
                  )}
                  title="Invoiced total"
                  caption="Invoices issued in this period"
                />

                <StatCard
                  icon="📤"
                  value={`${draftCount} / ${sentCount} / ${paidCount}`}
                  title="Draft / sent / paid"
                  caption="Invoice pipeline"
                />

                <StatCard
                  icon="⚠️"
                  value={
                    overdueInvoices.length
                  }
                  title="Overdue invoices"
                  caption="Unpaid invoices past due"
                />

                <StatCard
                  icon="💸"
                  value={formatMoney(
                    overdueValue
                  )}
                  title="Overdue value"
                  caption="Outstanding past due"
                />
              </div>

              <SectionTitle>
                Growth & compliance
              </SectionTitle>

              <div style={statGridStyle}>
                <StatCard
                  icon="🆕"
                  value={newCustomers}
                  title="New customers"
                  caption="Customers added in this period"
                />

                <StatCard
                  icon="⏱️"
                  value={hoursAlerts}
                  title="Drivers' hours alerts"
                  caption="Driver-days over 9 hours"
                />

                <StatCard
                  icon="🚨"
                  value={
                    violationEvents
                  }
                  title="Violation events"
                  caption="Detected compliance events"
                />

                <StatCard
                  icon="📡"
                  value={speedAlerts}
                  title="Speed alerts"
                  caption={`Readings over ${SPEED_ALERT_THRESHOLD} km/h`}
                />

                <StatCard
                  icon="🕒"
                  value={`${drivingHours.toFixed(
                    1
                  )} h`}
                  title="Driving hours logged"
                  caption="Total driving time in this period"
                />
              </div>

              <SectionTitle>
                Fleet — right now
              </SectionTitle>

              <p style={sectionCaptionStyle}>
                Snapshot figures are not
                affected by the period
                selector.
              </p>

              <div style={statGridStyle}>
                <StatCard
                  icon="🚛"
                  value={`${activeVehicles} / ${vehicles.length}`}
                  title="Active vehicles"
                  caption="Active vs total fleet"
                />

                <StatCard
                  icon="💼"
                  value={
                    billableVehicles
                  }
                  title="Billable vehicles"
                  caption="Active vehicles marked billable"
                />

                <StatCard
                  icon="🛠️"
                  value={
                    vehiclesOffRoad
                  }
                  title="Vehicles off road"
                  caption="Inactive / VOR vehicles"
                />

                <StatCard
                  icon="🧑‍✈️"
                  value={`${activeDrivers} / ${drivers.length}`}
                  title="Active drivers"
                  caption="Active vs total drivers"
                />

                <StatCard
                  icon="📄"
                  value={
                    licencesExpiringSoon
                  }
                  title="Licences expiring"
                  caption="Within the next 30 days"
                />
              </div>

              <SectionTitle>
                Driver leaderboard
              </SectionTitle>

              <div style={tableCardStyle}>
                {driverLeaderboard.length ===
                0 ? (
                  <p style={emptyTextStyle}>
                    No jobs with assigned
                    drivers in this period.
                  </p>
                ) : (
                  <table
                    style={tableStyle}
                  >
                    <thead>
                      <tr>
                        <th style={thStyle}>
                          Driver
                        </th>

                        <th style={thStyle}>
                          Jobs
                        </th>

                        <th style={thStyle}>
                          Completed
                        </th>

                        <th style={thStyle}>
                          Revenue
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {driverLeaderboard.map(
                        (row) => (
                          <tr key={row.id}>
                            <td
                              style={
                                tdStyle
                              }
                            >
                              {row.name}
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {row.jobs}
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {
                                row.completed
                              }
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {formatMoney(
                                row.revenue
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <SectionTitle>
                Top customers
              </SectionTitle>

              <div style={tableCardStyle}>
                {topCustomers.length ===
                0 ? (
                  <p style={emptyTextStyle}>
                    No jobs in this
                    period.
                  </p>
                ) : (
                  <table
                    style={tableStyle}
                  >
                    <thead>
                      <tr>
                        <th style={thStyle}>
                          Customer
                        </th>

                        <th style={thStyle}>
                          Jobs
                        </th>

                        <th style={thStyle}>
                          Completed
                        </th>

                        <th style={thStyle}>
                          Revenue
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {topCustomers.map(
                        (row) => (
                          <tr key={row.id}>
                            <td
                              style={
                                tdStyle
                              }
                            >
                              {row.name}
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {row.jobs}
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {
                                row.completed
                              }
                            </td>

                            <td
                              style={
                                tdStyle
                              }
                            >
                              {formatMoney(
                                row.revenue
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </TenantGate>
  );
}

function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <h2 style={sectionTitleStyle}>
      {children}
    </h2>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: 30,
  backgroundImage:
    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
  backgroundSize: "cover",
  backgroundPosition: "center",
  backgroundAttachment: "fixed",
};

const overlayStyle: CSSProperties = {
  background: "rgba(0,0,0,0.60)",
  padding: 30,
  borderRadius: 20,
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 20,
  flexWrap: "wrap",
  color: "white",
  marginBottom: 24,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 38,
};

const subtitleStyle: CSSProperties = {
  opacity: 0.85,
  margin: "6px 0 0",
};

const tenantLabelStyle: CSSProperties = {
  opacity: 0.55,
  fontSize: 11,
  margin: "7px 0 0",
};

const refreshButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.95)",
  color: "#0f172a",
  borderRadius: 10,
  padding: "10px 15px",
  fontWeight: 700,
  cursor: "pointer",
};

const messageStyle: CSSProperties = {
  background: "#fee2e2",
  border: "1px solid #fecaca",
  padding: 14,
  borderRadius: 12,
  color: "#991b1b",
  marginBottom: 20,
};

const loadingStyle: CSSProperties = {
  color: "white",
  padding: "30px 0",
  fontWeight: 600,
};

const periodBarStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 24,
};

const periodButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827",
  fontWeight: 600,
  cursor: "pointer",
};

const periodButtonActiveStyle: CSSProperties = {
  ...periodButtonStyle,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
};

const statGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 20,
  marginBottom: 30,
};

const statCardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  padding: 20,
  borderRadius: 14,
  boxShadow:
    "0 8px 30px rgba(0,0,0,0.25)",
};

const sectionTitleStyle: CSSProperties = {
  color: "white",
  marginTop: 0,
  marginBottom: 14,
};

const sectionCaptionStyle: CSSProperties = {
  color: "white",
  opacity: 0.85,
  marginTop: -8,
};

const tableCardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  padding: 22,
  borderRadius: 16,
  boxShadow:
    "0 10px 30px rgba(0,0,0,0.18)",
  overflowX: "auto",
  marginBottom: 30,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "transparent",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: 12,
  borderBottom:
    "1px solid #e5e7eb",
  color: "#111827",
  fontSize: 14,
};

const tdStyle: CSSProperties = {
  padding: 12,
  borderBottom:
    "1px solid #f1f5f9",
  color: "#111827",
  verticalAlign: "top",
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
  color: "#555",
};