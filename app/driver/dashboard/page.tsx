"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isDriverJobForDate } from "../../../lib/driver/dashboardJobs";

type Driver = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  licence_number: string | null;
  licence_expiry: string | null;
  licence_check_due: string | null;
  points_total: number | null;
  licence_points: number | null;
  tachograph_expiry: string | null;
  tachograph_next_download_due: string | null;
  cpc_expiry: string | null;
  adr_expiry: string | null;
  active: boolean;
};

type Job = {
  id: string;
  reference: string | null;
  customer_reference: string | null;
  status: string | null;
  job_date: string | null;
  scheduled_date: string | null;
  priority: string | null;
  notes: string | null;
  pod_status: string | null;
  vehicle_id: string | null;
  route_order: number | null;
};

type DriverResponse = {
  driver: Driver;
  jobs: Job[];
  vehicleAssignments: Array<{
    id: string;
    vehicle_id: string;
    active: boolean;
  }>;
};

export default function DriverDashboardPage() {
  const [data, setData] = useState<DriverResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/driver/me", {
        cache: "no-store",
      });

      const body = (await response.json()) as DriverResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to load driver dashboard.");
      }

      setData(body);
      setMessage("");
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error ? error.message : "Unable to load driver dashboard."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const todaysJobs = useMemo(() => {
    if (!data) return [];

    const today = new Date().toISOString().slice(0, 10);

    return data.jobs
      .filter((job) => isDriverJobForDate(job, today))
      .sort((a, b) => {
        const aOrder = a.route_order ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.route_order ?? Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        return (a.reference ?? "").localeCompare(b.reference ?? "");
      });
  }, [data]);

  if (loading) {
    return <main style={styles.page}>Loading driver dashboard...</main>;
  }

  if (!data?.driver) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <h1>Driver Dashboard</h1>
          <p>{message || "Driver access unavailable."}</p>
        </div>
      </main>
    );
  }

  const driver = data.driver;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Driver Portal</p>
            <h1 style={styles.title}>{driver.name}</h1>
            <p style={styles.subtitle}>
              {todaysJobs.length} job{todaysJobs.length === 1 ? "" : "s"} today
            </p>
          </div>
        </header>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Compliance</h2>
          <div style={styles.complianceGrid}>
            <Compliance label="Licence" date={driver.licence_expiry} />
            <Compliance label="Licence Check" date={driver.licence_check_due} />
            <Compliance label="Tachograph" date={driver.tachograph_expiry} />
            <Compliance
              label="Tacho Download"
              date={driver.tachograph_next_download_due}
            />
            <Compliance label="CPC" date={driver.cpc_expiry} />
            <Compliance label="ADR" date={driver.adr_expiry} />
          </div>

          <div style={styles.infoGrid}>
            <Info
              label="Licence Points"
              value={String(driver.points_total ?? driver.licence_points ?? 0)}
            />
            <Info label="Phone" value={driver.phone} />
            <Info label="Email" value={driver.email} />
            <Info
              label="Vehicle Assignment"
              value={
                data.vehicleAssignments.length > 0
                  ? "Assigned"
                  : "No active vehicle"
              }
            />
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Today's Jobs</h2>

          {todaysJobs.length === 0 ? (
            <p style={styles.muted}>No jobs assigned for today.</p>
          ) : (
            <div style={styles.listGrid}>
              {todaysJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/driver/jobs/${job.id}`}
                  style={styles.jobLink}
                >
                  <article style={styles.listCard}>
                    <div style={styles.rowBetween}>
                      <strong>{job.reference || "Job"}</strong>
                      <span style={styles.badge}>
                        {job.status || "Pending"}
                      </span>
                    </div>

                    <div style={styles.infoGrid}>
                      <Info
                        label="Reference"
                        value={job.customer_reference}
                      />
                      <Info
                        label="Priority"
                        value={job.priority}
                      />
                      <Info
                        label="POD"
                        value={job.pod_status || "Pending"}
                      />
                      <Info
                        label="Drop"
                        value={
                          job.route_order === null
                            ? "Unsequenced"
                            : String(job.route_order)
                        }
                      />
                    </div>

                    {job.notes ? (
                      <p style={styles.muted}>
                        {job.notes}
                      </p>
                    ) : null}

                    <div style={styles.openJob}>
                      Open job →
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Recent Assigned Jobs</h2>
          <div style={styles.listGrid}>
            {data.jobs.slice(0, 20).map((job) => (
              <Link
                key={job.id}
                href={`/driver/jobs/${job.id}`}
                style={styles.jobLink}
              >
                <article style={styles.listCard}>
                  <div style={styles.rowBetween}>
                    <strong>{job.reference || "Job"}</strong>
                    <span style={styles.badge}>
                      {job.status || "Pending"}
                    </span>
                  </div>

                  <p style={styles.muted}>
                    {formatDate(
                      job.job_date ||
                        job.scheduled_date,
                    )}
                  </p>

                  <div style={styles.openJob}>
                    Open job →
                  </div>
                </article>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Compliance({
  label,
  date,
}: {
  label: string;
  date: string | null;
}) {
  const result = getCompliance(date);

  return (
    <div style={complianceCard(result.level)}>
      <span style={styles.smallLabel}>{label}</span>
      <strong>{formatDate(date)}</strong>
      <span style={styles.muted}>{result.label}</span>
    </div>
  );
}

function getCompliance(date: string | null) {
  if (!date) return { level: "amber" as const, label: "Date needed" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${date}T00:00:00`);
  const days = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { level: "red" as const, label: "Expired" };
  if (days <= 7) return { level: "red" as const, label: "Needs attention" };
  if (days <= 30) return { level: "amber" as const, label: "Expiring soon" };
  return { level: "ok" as const, label: "Valid" };
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

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

function complianceCard(level: "ok" | "amber" | "red") {
  return {
    borderRadius: 12,
    padding: 14,
    border:
      level === "red"
        ? "2px solid #dc2626"
        : level === "amber"
          ? "2px solid #f59e0b"
          : "1px solid #e2e8f0",
    background:
      level === "red"
        ? "#fff1f2"
        : level === "amber"
          ? "#fffbeb"
          : "#f8fafc",
    display: "grid",
    gap: 5,
  } as React.CSSProperties;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 20px 60px",
    background: "#f8fafc",
    color: "#0f172a",
  },
  container: { maxWidth: 1200, margin: "0 auto" },
  header: { marginBottom: 24 },
  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  title: { margin: 0, fontSize: 42 },
  subtitle: { margin: "8px 0 0", color: "#64748b" },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 22,
    marginBottom: 22,
  },
  sectionTitle: { marginTop: 0 },
  complianceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 18,
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
  },
  listGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14,
  },
  jobLink: {
    display: "block",
    color: "inherit",
    textDecoration: "none",
  },
  openJob: {
    marginTop: 14,
    color: "#2563eb",
    fontSize: 13,
    fontWeight: 900,
  },
  listCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
    background: "#f8fafc",
  },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  badge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#e2e8f0",
    fontSize: 11,
    fontWeight: 800,
  },
  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: { display: "block", marginTop: 4 },
  muted: { color: "#64748b", fontSize: 12 },
};

