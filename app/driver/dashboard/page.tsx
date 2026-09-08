"use client";

import Link from "next/link";
import Skeleton from "../../../components/Skeleton";
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
    return (
      <main className={styles.page} aria-busy>
        <div className={styles.container}>
          <span className="sr-only" role="status">
            Loading driver dashboard
          </span>

          <header className={styles.header}>
            <Skeleton w="9ch" h="0.625rem" />
            <div className="mt-1">
              <Skeleton w="14ch" h="1.25rem" />
            </div>
            <div className="mt-2">
              <Skeleton w="12ch" h="0.75rem" />
            </div>
          </header>

          <section className={styles.card}>
            <Skeleton w="10ch" h="1rem" />

            <div className={styles.complianceGrid}>
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={`compliance-skeleton-${index}`}
                  className="grid gap-1.5 rounded-lg border border-line bg-surface-2 p-3.5"
                >
                  <Skeleton w="7ch" h="0.625rem" />
                  <Skeleton w="9ch" h="0.875rem" />
                </div>
              ))}
            </div>

            <div className={styles.infoGrid}>
              {[0, 1, 2, 3].map((index) => (
                <div key={`info-skeleton-${index}`}>
                  <Skeleton w="6ch" h="0.625rem" />
                  <div className="mt-1">
                    <Skeleton w="10ch" h="0.875rem" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!data?.driver) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1>Driver Dashboard</h1>
          <p>{message || "Driver access unavailable."}</p>
        </div>
      </main>
    );
  }

  const driver = data.driver;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Driver Portal</p>
            <h1 className={styles.title}>{driver.name}</h1>
            <p className={styles.subtitle}>
              {todaysJobs.length} job{todaysJobs.length === 1 ? "" : "s"} today
            </p>
          </div>
        </header>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Compliance</h2>
          <div className={styles.complianceGrid}>
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

          <div className={styles.infoGrid}>
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

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Today's Jobs</h2>

          {todaysJobs.length === 0 ? (
            <p className={styles.muted}>No jobs assigned for today.</p>
          ) : (
            <div className={styles.listGrid}>
              {todaysJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/driver/jobs/${job.id}`}
                  className={styles.jobLink}
                >
                  <article className={styles.listCard}>
                    <div className={styles.rowBetween}>
                      <strong>{job.reference || "Job"}</strong>
                      <span className={styles.badge}>
                        {job.status || "Pending"}
                      </span>
                    </div>

                    <div className={styles.infoGrid}>
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
                      <p className={styles.muted}>
                        {job.notes}
                      </p>
                    ) : null}

                    <div className={styles.openJob}>
                      Open job →
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Recent Assigned Jobs</h2>
          <div className={styles.listGrid}>
            {data.jobs.slice(0, 20).map((job) => (
              <Link
                key={job.id}
                href={`/driver/jobs/${job.id}`}
                className={styles.jobLink}
              >
                <article className={styles.listCard}>
                  <div className={styles.rowBetween}>
                    <strong>{job.reference || "Job"}</strong>
                    <span className={styles.badge}>
                      {job.status || "Pending"}
                    </span>
                  </div>

                  <p className={styles.muted}>
                    {formatDate(
                      job.job_date ||
                        job.scheduled_date,
                    )}
                  </p>

                  <div className={styles.openJob}>
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
    <div className={complianceCard(result.level)}>
      <span className={styles.smallLabel}>{label}</span>
      <strong>{formatDate(date)}</strong>
      <span className={styles.muted}>{result.label}</span>
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
      <span className={styles.smallLabel}>{label}</span>
      <strong className={styles.infoValue}>{value || "—"}</strong>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB");
}

/* Token classes, not inline styles: this page used to carry its own light
   palette (#f8fafc canvas, #0f172a ink, #2563eb accent) which could not follow
   the theme. Everything below is the same layout expressed in design-system
   tokens, so the page now renders correctly in both themes and is listed in
   lib/nav/themeableRoutes.ts. */
function complianceCard(level: "ok" | "amber" | "red") {
  const tone =
    level === "red"
      ? "border-2 border-danger bg-danger-tint"
      : level === "amber"
        ? "border-2 border-warning bg-warning-tint"
        : "border border-line bg-surface-2";

  return `grid gap-1.5 rounded-lg p-3.5 ${tone}`;
}

const styles = {
  page: "ds min-h-screen bg-canvas px-5 pb-14 pt-8 font-sans text-ink",
  container: "mx-auto max-w-[1200px]",
  header: "mb-6",
  eyebrow: "m-0 mb-1.5 text-kicker uppercase text-ink-3",
  title: "m-0 text-xl font-semibold tracking-tight text-ink",
  subtitle: "m-0 mt-2 text-sm text-ink-3",
  card: "mb-5 rounded-lg border border-line bg-surface p-5 shadow-sm",
  sectionTitle: "m-0 mb-3 text-md font-semibold text-ink",
  complianceGrid:
    "mb-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3",
  infoGrid: "mt-3.5 grid grid-cols-2 gap-3",
  listGrid: "grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3.5",
  jobLink: "block text-inherit no-underline",
  openJob: "mt-3.5 text-xs font-semibold text-primary-deep",
  listCard: "rounded-lg border border-line bg-surface-2 p-4",
  rowBetween: "flex justify-between gap-3",
  badge:
    "rounded-full border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink-2",
  smallLabel: "block text-kicker uppercase text-ink-3",
  infoValue: "mt-1 block text-ink",
  muted: "m-0 text-xs text-ink-3",
} as const;

