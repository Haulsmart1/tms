"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "../../../components/Skeleton";

type PortalUser = {
  id: string;
  tenant_id: string;
  subcontractor_id: string;
  employee_id: string;
  user_id: string;
  role: string;
  active: boolean;
};

type Employee = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  directly_employed: boolean;
  active: boolean;
  owner: boolean;
};

type Subcontractor = {
  id: string;
  name: string;
  subcontractor_type: "owner_driver" | "fleet";
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  operator_licence_number: string | null;
  goods_in_transit_expiry: string | null;
  public_liability_expiry: string | null;
  employers_liability_expiry: string | null;
  motor_insurance_expiry: string | null;
  adr_capable: boolean;
};

type Job = {
  id: string;
  reference: string | null;
  customer_reference: string | null;
  external_reference: string | null;
  status: string | null;
  scheduled_date: string | null;
  job_date: string | null;
  priority: string | null;
  notes: string | null;
  subcontractor_cost: number | null;
  pod_status: string | null;
  completed_at: string | null;
};

type Vehicle = {
  id: string;
  registration: string;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  active: boolean;
  mot_expiry: string | null;
  tax_expiry: string | null;
  insurance_expiry: string | null;
  vor: boolean;
};

type PortalUserRow = {
  id: string;
  employee_id: string;
  user_id: string;
  role: string;
  active: boolean;
  email: string | null;
  employee: Employee | null;
};

type DashboardResponse = {
  portalUser: PortalUser;
  subcontractor: Subcontractor;
  employee: Employee;
  jobs: Job[];
  vehicles: Vehicle[];
  employees: Employee[];
  portalUsers: PortalUserRow[];
};

export default function SubcontractorDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviteEmployeeId, setInviteEmployeeId] = useState("");
  const [inviteRole, setInviteRole] = useState("driver");
  const [inviting, setInviting] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/subcontractor/me", {
        cache: "no-store",
      });

      const body = (await response.json()) as DashboardResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to load subcontractor portal.");
      }

      setData(body);
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load subcontractor portal."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const stats = useMemo(() => {
    const jobs = data?.jobs ?? [];

    return {
      total: jobs.length,
      awaiting: jobs.filter((job) =>
        ["pending", "assigned", "awaiting_acceptance"].includes(
          String(job.status).toLowerCase()
        )
      ).length,
      inProgress: jobs.filter((job) =>
        ["in_progress", "collected", "en_route"].includes(
          String(job.status).toLowerCase()
        )
      ).length,
      completed: jobs.filter((job) =>
        ["completed", "delivered"].includes(String(job.status).toLowerCase())
      ).length,
      podRequired: jobs.filter((job) =>
        !["complete", "completed", "approved"].includes(
          String(job.pod_status).toLowerCase()
        )
      ).length,
    };
  }, [data]);

  async function inviteEmployee() {
    if (!inviteEmployeeId) {
      setMessage("Choose an employee first.");
      return;
    }

    setInviting(true);
    setMessage("");

    try {
      const response = await fetch("/api/subcontractor/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: inviteEmployeeId,
          role: inviteRole,
        }),
      });

      const body = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to invite employee.");
      }

      setMessage(body.message || "Invitation sent.");
      setInviteEmployeeId("");
      await loadDashboard();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to invite employee."
      );
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} aria-busy>
        <div className={styles.container}>
          <span className="sr-only" role="status">
            Loading subcontractor portal
          </span>

          <header className={styles.header}>
            <Skeleton w="9ch" h="0.625rem" />
            <div className="mt-1">
              <Skeleton w="18ch" h="1.25rem" />
            </div>
            <div className="mt-2">
              <Skeleton w="26ch" h="0.75rem" />
            </div>
          </header>

          <div className={styles.statGrid}>
            {[0, 1, 2, 3].map((index) => (
              <div key={`stat-skeleton-${index}`} className={styles.statCard}>
                <Skeleton w="8ch" h="0.75rem" />
                <Skeleton w="5ch" h="1.5rem" />
              </div>
            ))}
          </div>

          <section className={styles.card}>
            <Skeleton w="12ch" h="1rem" />
            <div className={styles.listGrid}>
              {[0, 1, 2].map((index) => (
                <div key={`list-skeleton-${index}`} className={styles.listCard}>
                  <Skeleton w="11ch" h="0.875rem" />
                  <div className="mt-2">
                    <Skeleton w="16ch" h="0.75rem" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1>Subcontractor Portal</h1>
          <p>{message || "Portal access unavailable."}</p>
        </div>
      </main>
    );
  }

  const canManageUsers = data.portalUser.role === "subcontractor_admin";
  const eligibleEmployees = data.employees.filter(
    (employee) => employee.directly_employed && employee.active
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Subcontractor Portal</p>
            <h1 className={styles.title}>{data.subcontractor.name}</h1>
            <p className={styles.subtitle}>
              Signed in as {data.employee.full_name} ·{" "}
              {formatRole(data.portalUser.role)}
            </p>
          </div>
        </header>

        {message ? <div className={styles.message}>{message}</div> : null}

        <section className={styles.statGrid}>
          <Stat label="Jobs" value={stats.total} />
          <Stat label="Awaiting" value={stats.awaiting} />
          <Stat label="In Progress" value={stats.inProgress} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="POD Attention" value={stats.podRequired} />
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Assigned Jobs</h2>

          {data.jobs.length === 0 ? (
            <p className={styles.muted}>No jobs are currently assigned.</p>
          ) : (
            <div className={styles.listGrid}>
              {data.jobs.map((job) => (
                <article key={job.id} className={styles.listCard}>
                  <div className={styles.rowBetween}>
                    <strong>{job.reference || "Job"}</strong>
                    <span className={styles.badge}>{job.status || "Pending"}</span>
                  </div>
                  <p className={styles.muted}>
                    {job.customer_reference || job.external_reference || "No external reference"}
                  </p>
                  <div className={styles.infoGrid}>
                    <Info label="Job Date" value={formatDate(job.job_date || job.scheduled_date)} />
                    <Info label="Priority" value={job.priority} />
                    <Info
                      label="Cost"
                      value={
                        job.subcontractor_cost === null
                          ? "—"
                          : `£${Number(job.subcontractor_cost).toFixed(2)}`
                      }
                    />
                    <Info label="POD" value={job.pod_status || "Pending"} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Vehicles</h2>

          <div className={styles.listGrid}>
            {data.vehicles.map((vehicle) => {
              const compliance = mostUrgent([
                getCompliance(vehicle.mot_expiry),
                getCompliance(vehicle.tax_expiry),
                getCompliance(vehicle.insurance_expiry),
              ]);

              return (
                <article key={vehicle.id} className={vehicleCard(compliance.level)}>
                  <div className={styles.rowBetween}>
                    <div>
                      <strong>{vehicle.registration}</strong>
                      <div className={styles.muted}>
                        {[vehicle.vehicle_type, vehicle.make, vehicle.model]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <span className={styles.badge}>
                      {vehicle.vor ? "VOR" : compliance.label}
                    </span>
                  </div>

                  <div className={styles.infoGrid}>
                    <Info label="MOT" value={formatDate(vehicle.mot_expiry)} />
                    <Info label="Tax" value={formatDate(vehicle.tax_expiry)} />
                    <Info label="Insurance" value={formatDate(vehicle.insurance_expiry)} />
                    <Info label="Status" value={vehicle.active ? "Active" : "Inactive"} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {canManageUsers ? (
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Portal Users</h2>
            <p className={styles.muted}>
              Only active, directly employed people can be given portal access.
            </p>

            <div className={styles.inviteGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Employee</span>
                <select
                  className={styles.input}
                  value={inviteEmployeeId}
                  onChange={(event) => setInviteEmployeeId(event.target.value)}
                >
                  <option value="">Choose employee</option>
                  {eligibleEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.email ? ` · ${employee.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Portal Role</span>
                <select
                  className={styles.input}
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                >
                  <option value="subcontractor_admin">Subcontractor Admin</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="driver">Driver</option>
                  <option value="accounts">Accounts</option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => void inviteEmployee()}
                disabled={inviting}
                className={styles.primaryButton}
              >
                {inviting ? "Sending..." : "Invite to Portal"}
              </button>
            </div>

            <div className={styles.listGrid}>
              {data.portalUsers.map((portalUser) => (
                <article key={portalUser.id} className={styles.listCard}>
                  <strong>
                    {portalUser.employee?.full_name ||
                      portalUser.email ||
                      "Portal User"}
                  </strong>
                  <div className={styles.muted}>{portalUser.email || "No email"}</div>
                  <div className="mt-2">
                    <span className={styles.badge}>{formatRole(portalUser.role)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

type ComplianceResult = {
  level: "ok" | "amber" | "red";
  label: string;
};

function getCompliance(expiry: string | null): ComplianceResult {
  if (!expiry) return { level: "amber", label: "DATE NEEDED" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return { level: "red", label: "EXPIRED" };
  if (days <= 7) return { level: "red", label: "NEEDS ATTENTION" };
  if (days <= 30) return { level: "amber", label: "EXPIRING SOON" };
  return { level: "ok", label: "VALID" };
}

function mostUrgent(results: ComplianceResult[]) {
  const rank = { ok: 0, amber: 1, red: 2 };
  return results.reduce((current, next) =>
    rank[next.level] > rank[current.level] ? next : current
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.statCard}>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.muted}>{label}</span>
    </div>
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
      <span className={styles.smallLabel}>{label}</span>
      <strong className={styles.infoValue}>{value || "—"}</strong>
    </div>
  );
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
function vehicleCard(level: "ok" | "amber" | "red") {
  const tone =
    level === "red"
      ? "border-2 border-danger bg-danger-tint"
      : level === "amber"
        ? "border-2 border-warning bg-warning-tint"
        : "border border-line bg-surface-2";

  return `rounded-lg p-4 ${tone}`;
}

const styles = {
  page: "ds min-h-screen bg-canvas px-5 pb-14 pt-8 font-sans text-ink",
  container: "mx-auto max-w-[1450px]",
  header: "mb-6",
  eyebrow: "m-0 mb-1.5 text-kicker uppercase text-ink-3",
  title: "m-0 text-xl font-semibold tracking-tight text-ink",
  subtitle: "m-0 mt-2 text-sm text-ink-3",
  message: "mb-4 rounded-lg border border-line bg-surface p-3 text-sm text-ink",
  card: "mb-5 rounded-lg border border-line bg-surface p-5 shadow-sm",
  sectionTitle: "m-0 mb-3 text-md font-semibold text-ink",
  statGrid:
    "mb-5 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3",
  statCard:
    "grid gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm",
  statValue:
    "font-mono text-2xl font-semibold tabular-nums slashed-zero text-ink",
  listGrid:
    "mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5",
  listCard: "rounded-lg border border-line bg-surface-2 p-4",
  rowBetween: "flex items-start justify-between gap-3",
  badge:
    "rounded-full border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink-2",
  muted: "m-0 text-xs text-ink-3",
  infoGrid: "mt-3.5 grid grid-cols-2 gap-2.5",
  smallLabel: "block text-kicker uppercase text-ink-3",
  infoValue: "mt-0.5 block text-sm text-ink",
  inviteGrid:
    "mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-end gap-3",
  field: "grid gap-1.5",
  label: "text-sm font-medium text-ink-2",
  input:
    "h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3",
  primaryButton:
    "inline-flex h-10 cursor-pointer items-center justify-center rounded-md border-0 bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover active:bg-primary-active",
} as const;
