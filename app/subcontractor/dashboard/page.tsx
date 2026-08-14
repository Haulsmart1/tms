"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
    return <main style={styles.page}>Loading subcontractor portal...</main>;
  }

  if (!data) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
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
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Subcontractor Portal</p>
            <h1 style={styles.title}>{data.subcontractor.name}</h1>
            <p style={styles.subtitle}>
              Signed in as {data.employee.full_name} ·{" "}
              {formatRole(data.portalUser.role)}
            </p>
          </div>
        </header>

        {message ? <div style={styles.message}>{message}</div> : null}

        <section style={styles.statGrid}>
          <Stat label="Jobs" value={stats.total} />
          <Stat label="Awaiting" value={stats.awaiting} />
          <Stat label="In Progress" value={stats.inProgress} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="POD Attention" value={stats.podRequired} />
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Assigned Jobs</h2>

          {data.jobs.length === 0 ? (
            <p style={styles.muted}>No jobs are currently assigned.</p>
          ) : (
            <div style={styles.listGrid}>
              {data.jobs.map((job) => (
                <article key={job.id} style={styles.listCard}>
                  <div style={styles.rowBetween}>
                    <strong>{job.reference || "Job"}</strong>
                    <span style={styles.badge}>{job.status || "Pending"}</span>
                  </div>
                  <p style={styles.muted}>
                    {job.customer_reference || job.external_reference || "No external reference"}
                  </p>
                  <div style={styles.infoGrid}>
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

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Vehicles</h2>

          <div style={styles.listGrid}>
            {data.vehicles.map((vehicle) => {
              const compliance = mostUrgent([
                getCompliance(vehicle.mot_expiry),
                getCompliance(vehicle.tax_expiry),
                getCompliance(vehicle.insurance_expiry),
              ]);

              return (
                <article key={vehicle.id} style={vehicleCard(compliance.level)}>
                  <div style={styles.rowBetween}>
                    <div>
                      <strong>{vehicle.registration}</strong>
                      <div style={styles.muted}>
                        {[vehicle.vehicle_type, vehicle.make, vehicle.model]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <span style={styles.badge}>
                      {vehicle.vor ? "VOR" : compliance.label}
                    </span>
                  </div>

                  <div style={styles.infoGrid}>
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
          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>Portal Users</h2>
            <p style={styles.muted}>
              Only active, directly employed people can be given portal access.
            </p>

            <div style={styles.inviteGrid}>
              <label style={styles.field}>
                <span style={styles.label}>Employee</span>
                <select
                  style={styles.input}
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

              <label style={styles.field}>
                <span style={styles.label}>Portal Role</span>
                <select
                  style={styles.input}
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
                style={styles.primaryButton}
              >
                {inviting ? "Sending..." : "Invite to Portal"}
              </button>
            </div>

            <div style={styles.listGrid}>
              {data.portalUsers.map((portalUser) => (
                <article key={portalUser.id} style={styles.listCard}>
                  <strong>
                    {portalUser.employee?.full_name ||
                      portalUser.email ||
                      "Portal User"}
                  </strong>
                  <div style={styles.muted}>{portalUser.email || "No email"}</div>
                  <div style={{ marginTop: 8 }}>
                    <span style={styles.badge}>{formatRole(portalUser.role)}</span>
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
    <div style={styles.statCard}>
      <strong style={styles.statValue}>{value}</strong>
      <span style={styles.muted}>{label}</span>
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
      <span style={styles.smallLabel}>{label}</span>
      <strong style={styles.infoValue}>{value || "—"}</strong>
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

function vehicleCard(level: "ok" | "amber" | "red") {
  const border =
    level === "red" ? "#dc2626" : level === "amber" ? "#f59e0b" : "#e2e8f0";
  const background =
    level === "red" ? "#fff1f2" : level === "amber" ? "#fffbeb" : "#f8fafc";

  return {
    ...styles.listCard,
    border: `2px solid ${border}`,
    background,
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 20px 60px",
    background: "#f8fafc",
    color: "#0f172a",
  },
  container: { maxWidth: 1450, margin: "0 auto" },
  header: { marginBottom: 24 },
  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  title: { margin: 0, fontSize: 44 },
  subtitle: { margin: "8px 0 0", color: "#64748b" },
  message: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 10,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 22,
    marginBottom: 22,
  },
  sectionTitle: { marginTop: 0 },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginBottom: 22,
  },
  statCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 18,
    display: "grid",
    gap: 4,
  },
  statValue: { fontSize: 30 },
  listGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
    marginTop: 16,
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
    alignItems: "flex-start",
  },
  badge: {
    borderRadius: 999,
    padding: "5px 8px",
    background: "#e2e8f0",
    fontSize: 11,
    fontWeight: 800,
  },
  muted: { color: "#64748b", fontSize: 12 },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 14,
  },
  smallLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  infoValue: { display: "block", marginTop: 3, fontSize: 13 },
  inviteGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    alignItems: "end",
    marginTop: 16,
  },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 12, fontWeight: 800, color: "#475569" },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "11px 12px",
    background: "#ffffff",
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
};
