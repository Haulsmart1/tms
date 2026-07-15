"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

// EU daily driving limit (Regulation 561/2006): 9 hours.
const DAILY_DRIVING_LIMIT_MINUTES = 540;

// tracking/page.tsx renders vehicle_locations.speed as km/h; EU HGV speed limiters
// are set at 90 km/h, so readings above that are worth a look — tune per fleet.
const SPEED_ALERT_THRESHOLD = 90;

// Matched case-insensitively as substrings of driver_activity_logs.activity_type, so
// violation events start counting as soon as a telematics feed inserts such rows.
const VIOLATION_PATTERNS = ["harsh", "brak", "speed", "violat", "infring"];

function isViolationType(activityType: any): boolean {
  const type = String(activityType || "").toLowerCase();
  return VIOLATION_PATTERNS.some((pattern) => type.includes(pattern));
}

const PERIODS = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const statGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 20,
  marginBottom: 30,
};

const statCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  padding: 20,
  borderRadius: 14,
  boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
};

const sectionTitleStyle: React.CSSProperties = {
  color: "white",
  marginTop: 0,
  marginBottom: 14,
};

const tableCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  padding: 22,
  borderRadius: 16,
  boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  overflowX: "auto",
  marginBottom: 30,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "transparent",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
  fontSize: 14,
};

const tdStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #f1f5f9",
  color: "#111827",
  verticalAlign: "top",
};

const periodButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827",
  fontWeight: 600,
  cursor: "pointer",
};

const periodButtonActiveStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "-";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function periodStart(period: PeriodKey): Date | null {
  const now = new Date();
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (period === "quarter") {
    return new Date(now.getFullYear(), now.getMonth() - 2, 1);
  }
  if (period === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

function isInPeriod(value: any, start: Date | null) {
  if (!start) {
    return true;
  }
  if (!value) {
    return false;
  }
  return new Date(value) >= start;
}

// Supabase joined rows can come back as an object or a one-element array
// (same reason lib/roles.ts has extractRoleName), so read names defensively.
function embeddedName(value: any): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0]?.name ?? null;
  }
  return value.name ?? null;
}

function groupJobsBy(
  jobsList: any[],
  keyField: string,
  nameField: string
): Array<{
  id: string;
  name: string;
  jobs: number;
  completed: number;
  revenue: number;
}> {
  const map = new Map<
    string,
    { id: string; name: string; jobs: number; completed: number; revenue: number }
  >();
  for (const job of jobsList) {
    const key = job[keyField];
    if (!key) {
      continue;
    }
    const entry =
      map.get(key) ||
      {
        id: String(key),
        name: embeddedName(job[nameField]) || "Unknown",
        jobs: 0,
        completed: 0,
        revenue: 0,
      };
    entry.jobs += 1;
    if (job.status === "completed") {
      entry.completed += 1;
    }
    entry.revenue += Number(job.customer_price) || 0;
    map.set(key, entry);
  }
  return Array.from(map.values())
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
      <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden="true">
        {icon}
      </div>
      <h2 style={{ margin: 0 }}>{value}</h2>
      <p style={{ margin: "4px 0 0 0", fontWeight: 600 }}>{title}</p>
      <p style={{ margin: 0, color: "#555", fontSize: 14 }}>{caption}</p>
    </div>
  );
}

export default function StatsPage() {
  const supabase = createClient();

  const [status, setStatus] = useState<"loading" | "signed-out" | "ready">(
    "loading"
  );
  const [message, setMessage] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("month");

  const [jobs, setJobs] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [licences, setLicences] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [logsUsable, setLogsUsable] = useState(true);
  const [speedReadings, setSpeedReadings] = useState<any[]>([]);

  async function loadStats() {
    setMessage("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        setStatus("signed-out");
        return;
      }

      // Deliberately no hardcoded fallback tenant here: on a revenue page,
      // showing another company's numbers is a leak, not a convenience.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        setMessage(`Profile load error: ${profileError.message}`);
        setStatus("ready");
        return;
      }

      const tenantId = profile?.tenant_id;
      if (!tenantId) {
        setMessage(
          "Your profile has no company assigned yet — ask your administrator."
        );
        setStatus("ready");
        return;
      }

      // Jobs and invoices are ordered newest-first so the PostgREST ~1000-row
      // response cap keeps the most recent records if a table ever outgrows it.
      // The proper fix at scale is a SQL view (see design doc).
      const [
        jobsRes,
        invoicesRes,
        vehiclesRes,
        driversRes,
        customersRes,
        licencesRes,
        speedRes,
      ] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            `
            id,
            reference,
            status,
            scheduled_date,
            customer_price,
            subcontractor_cost,
            subcontractor_id,
            customer_id,
            driver_id,
            customers ( name ),
            drivers ( name ),
            job_stops ( id, type, status, pod_status, delivered_at )
          `
          )
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, issue_date, due_date, total_amount, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("vehicles")
          .select("id, active")
          .eq("tenant_id", tenantId),
        supabase
          .from("drivers")
          .select("id, name, active")
          .eq("tenant_id", tenantId),
        supabase
          .from("customers")
          .select("id, name, active, created_at")
          .eq("tenant_id", tenantId),
        supabase
          .from("vehicle_licences")
          .select("id, active, expiry_date")
          .eq("tenant_id", tenantId),
        // Only rows already over the threshold cross the wire.
        supabase
          .from("vehicle_locations")
          .select("id, speed, recorded_at")
          .eq("tenant_id", tenantId)
          .gt("speed", SPEED_ALERT_THRESHOLD)
          .order("recorded_at", { ascending: false })
          .limit(1000),
      ]);

      const failures: Array<[string, any]> = [
        ["Jobs", jobsRes.error],
        ["Invoices", invoicesRes.error],
        ["Vehicles", vehiclesRes.error],
        ["Drivers", driversRes.error],
        ["Customers", customersRes.error],
        ["Licences", licencesRes.error],
        ["Speed readings", speedRes.error],
      ];
      for (const [label, error] of failures) {
        if (error) {
          setMessage(`${label} load error: ${error.message}`);
          setStatus("ready");
          return;
        }
      }

      // Activity logs have no tenant column, so scope them server-side to this
      // company's drivers. NOTE for the RLS audit: a query filter is UX, not
      // authorization — only a row-level policy can stop a browser from reading
      // other tenants' logs.
      const driverIds = (driversRes.data || []).map((driver) => driver.id);
      let logsData: any[] = [];
      let logsQueryWorked = true;
      if (driverIds.length > 0) {
        const logsRes = await supabase
          .from("driver_activity_logs")
          .select("*")
          .in("driver_id", driverIds)
          .order("start_time", { ascending: false })
          .limit(1000);
        if (logsRes.error) {
          // Most likely cause: the table has no driver_id column (nothing else
          // in the app references one). Degrade the tacho cards to "-" instead
          // of failing the whole page.
          logsQueryWorked = false;
        } else {
          logsData = logsRes.data || [];
        }
      }

      setJobs(jobsRes.data || []);
      setInvoices(invoicesRes.data || []);
      setVehicles(vehiclesRes.data || []);
      setDrivers(driversRes.data || []);
      setCustomers(customersRes.data || []);
      setLicences(licencesRes.data || []);
      setActivityLogs(logsData);
      setLogsUsable(logsQueryWorked);
      setSpeedReadings(speedRes.data || []);
      setStatus("ready");
    } catch (error) {
      setMessage(
        `Failed to load stats: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      setStatus("ready");
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  const start = periodStart(period);
  const now = new Date();
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  // Jobs & revenue
  const periodJobs = jobs.filter((job) => isInPeriod(job.scheduled_date, start));
  const completedJobs = periodJobs.filter((job) => job.status === "completed");
  const plannedJobs = periodJobs.filter((job) => job.status === "planned");
  const revenue = periodJobs.reduce(
    (sum, job) => sum + (Number(job.customer_price) || 0),
    0
  );
  const subCost = periodJobs.reduce(
    (sum, job) => sum + (Number(job.subcontractor_cost) || 0),
    0
  );
  const margin = revenue - subCost;
  const subbedJobs = periodJobs.filter((job) => job.subcontractor_id);
  const ownFleetJobs = periodJobs.length - subbedJobs.length;

  // Delivery & POD. Only delivery stops can carry a POD — collection stops stay
  // "pending" forever (see jobs/pod pages) — so collections are excluded here or
  // the rate would cap out around 50%.
  const periodStops = periodJobs.flatMap((job) => job.job_stops || []);
  const deliveryStops = periodStops.filter((stop) => stop.type === "delivery");
  const deliveredStops = deliveryStops.filter(
    (stop) => stop.pod_status === "delivered"
  );
  const pendingPods = deliveryStops.length - deliveredStops.length;
  const podRate =
    deliveryStops.length > 0
      ? `${Math.round((deliveredStops.length / deliveryStops.length) * 100)}%`
      : "-";

  // Invoicing
  const periodInvoices = invoices.filter((invoice) =>
    isInPeriod(invoice.issue_date, start)
  );
  const invoicedTotal = periodInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice.total_amount) || 0),
    0
  );
  const draftCount = periodInvoices.filter((i) => i.status === "draft").length;
  const sentCount = periodInvoices.filter((i) => i.status === "sent").length;
  const paidCount = periodInvoices.filter((i) => i.status === "paid").length;
  // Overdue is a "right now" snapshot over ALL invoices — filtering by the
  // period's issue date would hide exactly the old unpaid invoices that matter
  // most. Drafts are excluded: an invoice never sent can't be overdue.
  const overdueInvoices = invoices.filter(
    (invoice) =>
      invoice.status === "sent" &&
      invoice.due_date &&
      new Date(invoice.due_date) < todayMidnight
  );
  const overdueValue = overdueInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice.total_amount) || 0),
    0
  );

  // Growth
  const newCustomers = customers.filter((customer) =>
    isInPeriod(customer.created_at, start)
  ).length;

  // Tacho / compliance (logs are already scoped to this company's drivers in
  // the query). Violation event rows can contain "driv" too (e.g.
  // "driving_time_violation"), so they are kept out of the duty-time sums.
  const scopedLogs = activityLogs.filter((log) =>
    isInPeriod(log.start_time, start)
  );
  const drivingLogs = scopedLogs.filter((log) => {
    const type = String(log.activity_type || "").toLowerCase();
    return type.includes("driv") && !isViolationType(type);
  });
  const drivingMinutesByDriverDay = new Map<string, number>();
  for (const log of drivingLogs) {
    if (!log.start_time) {
      continue;
    }
    const startedAt = new Date(log.start_time);
    if (isNaN(startedAt.getTime())) {
      continue;
    }
    const dayKey = `${log.driver_id}|${startedAt.getFullYear()}-${
      startedAt.getMonth() + 1
    }-${startedAt.getDate()}`;
    drivingMinutesByDriverDay.set(
      dayKey,
      (drivingMinutesByDriverDay.get(dayKey) || 0) +
        (Number(log.duration_minutes) || 0)
    );
  }
  let hoursAlerts = 0;
  drivingMinutesByDriverDay.forEach((minutes) => {
    if (minutes > DAILY_DRIVING_LIMIT_MINUTES) {
      hoursAlerts += 1;
    }
  });
  const violationEvents = scopedLogs.filter((log) =>
    isViolationType(log.activity_type)
  ).length;
  const drivingHours = Math.round(
    drivingLogs.reduce(
      (sum, log) => sum + (Number(log.duration_minutes) || 0),
      0
    ) / 60
  );
  const speedAlerts = speedReadings.filter((reading) =>
    isInPeriod(reading.recorded_at, start)
  ).length;

  // Fleet snapshot (deliberately ignores the period selector)
  const activeVehicles = vehicles.filter((vehicle) => vehicle.active).length;
  const vehiclesOffRoad = vehicles.length - activeVehicles;
  const activeDrivers = drivers.filter((driver) => driver.active).length;
  const thirtyDaysAhead = new Date(
    todayMidnight.getFullYear(),
    todayMidnight.getMonth(),
    todayMidnight.getDate() + 30
  );
  const licencesExpiringSoon = licences.filter((licence) => {
    if (!licence.active || !licence.expiry_date) {
      return false;
    }
    const expiry = new Date(licence.expiry_date);
    return expiry >= todayMidnight && expiry <= thirtyDaysAhead;
  }).length;

  // Matches the own-fleet definition above: a job with a subcontractor on it
  // was run by the subcontractor, so it doesn't credit an in-house driver.
  const driverLeaderboard = groupJobsBy(
    periodJobs.filter((job) => job.driver_id && !job.subcontractor_id),
    "driver_id",
    "drivers"
  );
  const topCustomers = groupJobsBy(periodJobs, "customer_id", "customers");

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.60)",
          padding: 30,
          borderRadius: 20,
        }}
      >
        <div style={{ color: "white", marginBottom: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 38 }}>Company Stats</h1>
          <p style={{ opacity: 0.85, marginBottom: 0 }}>
            Your company's performance across jobs, deliveries, invoicing and
            fleet.
          </p>
        </div>

        {message ? (
          <div
            style={{
              background: "rgba(255,255,255,0.94)",
              padding: 14,
              borderRadius: 12,
              color: "#111827",
              marginBottom: 20,
            }}
          >
            {message}
          </div>
        ) : null}

        {status === "loading" ? (
          <p style={{ color: "white" }}>Loading stats...</p>
        ) : null}

        {status === "signed-out" ? (
          <div style={{ ...statCardStyle, maxWidth: 420 }}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>
              Sign in to view stats
            </h2>
            <p style={{ margin: "0 0 14px 0", color: "#555" }}>
              Company stats are only available to signed-in members.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block",
                padding: "10px 14px",
                borderRadius: 10,
                background: "#111827",
                color: "white",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to sign in
            </a>
          </div>
        ) : null}

        {status === "ready" ? (
          <div>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 24,
              }}
            >
              {PERIODS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={period === option.key}
                  onClick={() => setPeriod(option.key)}
                  style={
                    period === option.key
                      ? periodButtonActiveStyle
                      : periodButtonStyle
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>

            <h2 style={sectionTitleStyle}>Jobs & revenue</h2>
            <div style={statGridStyle}>
              <StatCard
                icon="📦"
                value={periodJobs.length}
                title="Total jobs"
                caption="Jobs scheduled in this period"
              />
              <StatCard
                icon="✅"
                value={completedJobs.length}
                title="Completed"
                caption="Jobs marked completed"
              />
              <StatCard
                icon="🗓️"
                value={plannedJobs.length}
                title="Planned"
                caption="Jobs still planned"
              />
              <StatCard
                icon="💷"
                value={formatMoney(revenue)}
                title="Revenue"
                caption="Sum of customer prices"
              />
              <StatCard
                icon="🧾"
                value={formatMoney(subCost)}
                title="Subcontractor cost"
                caption="Sum of subcontractor costs"
              />
              <StatCard
                icon="📈"
                value={formatMoney(margin)}
                title="Margin"
                caption="Revenue minus subcontractor cost"
              />
              <StatCard
                icon="🚚"
                value={`${ownFleetJobs} / ${subbedJobs.length}`}
                title="Own fleet / subbed"
                caption="Jobs run in-house vs subcontracted"
              />
            </div>

            <h2 style={sectionTitleStyle}>Delivery & POD</h2>
            <div style={statGridStyle}>
              <StatCard
                icon="📍"
                value={`${deliveredStops.length} / ${deliveryStops.length}`}
                title="Stops delivered"
                caption="Delivered vs total delivery stops"
              />
              <StatCard
                icon="📸"
                value={podRate}
                title="POD rate"
                caption="Delivery stops with proof of delivery"
              />
              <StatCard
                icon="⏳"
                value={pendingPods}
                title="PODs pending"
                caption="Delivery stops awaiting proof"
              />
            </div>

            <h2 style={sectionTitleStyle}>Invoicing</h2>
            <div style={statGridStyle}>
              <StatCard
                icon="💷"
                value={formatMoney(invoicedTotal)}
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
                value={overdueInvoices.length}
                title="Overdue invoices"
                caption="Sent & unpaid, past due — all time"
              />
              <StatCard
                icon="💸"
                value={formatMoney(overdueValue)}
                title="Overdue value"
                caption="Outstanding past due — all time"
              />
            </div>

            <h2 style={sectionTitleStyle}>Growth & compliance</h2>
            <div style={statGridStyle}>
              <StatCard
                icon="🆕"
                value={newCustomers}
                title="New customers"
                caption="Customers added in this period"
              />
              <StatCard
                icon="⏱️"
                value={logsUsable ? hoursAlerts : "-"}
                title="Drivers' hours alerts"
                caption={
                  logsUsable
                    ? "Driver-days over the 9h driving limit"
                    : "Needs driver_id on activity logs"
                }
              />
              <StatCard
                icon="🚨"
                value={logsUsable ? violationEvents : "-"}
                title="Violation events"
                caption={
                  logsUsable
                    ? "Harsh braking, speeding & other events"
                    : "Needs driver_id on activity logs"
                }
              />
              <StatCard
                icon="📡"
                value={speedAlerts}
                title="Speed alerts"
                caption={`Tracker readings over ${SPEED_ALERT_THRESHOLD} km/h`}
              />
              <StatCard
                icon="🕒"
                value={logsUsable ? drivingHours : "-"}
                title="Driving hours logged"
                caption={
                  logsUsable
                    ? "Total driving time in this period"
                    : "Needs driver_id on activity logs"
                }
              />
            </div>

            <h2 style={sectionTitleStyle}>Fleet — right now</h2>
            <p style={{ color: "white", opacity: 0.85, marginTop: -8 }}>
              Snapshot figures — not affected by the period selector.
            </p>
            <div style={statGridStyle}>
              <StatCard
                icon="🚛"
                value={`${activeVehicles} / ${vehicles.length}`}
                title="Active vehicles"
                caption="Active vs total fleet"
              />
              <StatCard
                icon="🛠️"
                value={vehiclesOffRoad}
                title="Vehicles off road"
                caption="Marked inactive / VOR"
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
                caption="Active licences expiring within 30 days"
              />
            </div>

            <h2 style={sectionTitleStyle}>Driver leaderboard</h2>
            <div style={tableCardStyle}>
              {driverLeaderboard.length === 0 ? (
                <p style={{ margin: 0, color: "#555" }}>
                  No jobs with assigned drivers in this period.
                </p>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle} scope="col">Driver</th>
                      <th style={thStyle} scope="col">Jobs</th>
                      <th style={thStyle} scope="col">Completed</th>
                      <th style={thStyle} scope="col">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverLeaderboard.map((row) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{row.name}</td>
                        <td style={tdStyle}>{row.jobs}</td>
                        <td style={tdStyle}>{row.completed}</td>
                        <td style={tdStyle}>{formatMoney(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <h2 style={sectionTitleStyle}>Top customers</h2>
            <div style={tableCardStyle}>
              {topCustomers.length === 0 ? (
                <p style={{ margin: 0, color: "#555" }}>
                  No jobs in this period.
                </p>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle} scope="col">Customer</th>
                      <th style={thStyle} scope="col">Jobs</th>
                      <th style={thStyle} scope="col">Completed</th>
                      <th style={thStyle} scope="col">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.map((row) => (
                      <tr key={row.id}>
                        <td style={tdStyle}>{row.name}</td>
                        <td style={tdStyle}>{row.jobs}</td>
                        <td style={tdStyle}>{row.completed}</td>
                        <td style={tdStyle}>{formatMoney(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
