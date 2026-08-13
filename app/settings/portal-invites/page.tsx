"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";

type Driver = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
};

type Subcontractor = {
  id: string;
  name: string;
};

type Employee = {
  id: string;
  subcontractor_id: string;
  full_name: string;
  email: string | null;
  directly_employed: boolean;
  active: boolean;
  employment_end_date: string | null;
};

type LoadData = {
  drivers: Driver[];
  subcontractors: Subcontractor[];
  employees: Employee[];
  driverUsers: Array<{ driver_id: string; active: boolean }>;
  subcontractorUsers: Array<{ employee_id: string; active: boolean }>;
};

export default function PortalInvitesPage() {
  const tenant = useTenant();
  const canManage = tenant.role === "admin" || tenant.role === "super_admin";

  const [data, setData] = useState<LoadData>({
    drivers: [],
    subcontractors: [],
    employees: [],
    driverUsers: [],
    subcontractorUsers: [],
  });

  const [driverId, setDriverId] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("subcontractor_admin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!tenant.activeTenantId) return;

    const response = await fetch(
      `/api/settings/portal-invites?tenantId=${encodeURIComponent(
        tenant.activeTenantId
      )}`,
      { cache: "no-store" }
    );

    const body = await response.json();

    if (!response.ok) {
      setMessage(body.error || "Unable to load invite data.");
      return;
    }

    setData(body);
  }, [tenant.activeTenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const eligibleEmployees = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    return data.employees.filter(
      (employee) =>
        employee.subcontractor_id === subcontractorId &&
        employee.directly_employed &&
        employee.active &&
        (!employee.employment_end_date ||
          employee.employment_end_date >= today)
    );
  }, [data.employees, subcontractorId]);

  async function send(payload: object) {
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/settings/portal-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Invitation failed.");
      }

      setMessage(body.message || "Invitation processed.");
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TenantGate>
      <main style={styles.page}>
        <div style={styles.container}>
          <h1 style={styles.title}>Portal Invitations</h1>
          <p style={styles.muted}>
            Invite ADR drivers or directly-employed subcontractor personnel.
          </p>

          {message ? <div style={styles.message}>{message}</div> : null}

          {!canManage ? (
            <div style={styles.card}>Only tenant admins can manage invites.</div>
          ) : (
            <>
              <section style={styles.card}>
                <h2>Invite Driver</h2>

                <select
                  style={styles.input}
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                >
                  <option value="">Choose driver</option>
                  {data.drivers
                    .filter((driver) => driver.active !== false)
                    .map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name}
                        {driver.email ? ` · ${driver.email}` : " · NO EMAIL"}
                        {data.driverUsers.some(
                          (row) => row.driver_id === driver.id && row.active
                        )
                          ? " · PORTAL ACTIVE"
                          : ""}
                      </option>
                    ))}
                </select>

                <button
                  style={styles.button}
                  disabled={busy || !driverId}
                  onClick={() =>
                    void send({
                      type: "driver",
                      tenantId: tenant.writeTenantId,
                      driverId,
                    })
                  }
                >
                  {busy ? "Working..." : "Invite Driver"}
                </button>
              </section>

              <section style={styles.card}>
                <h2>Invite Subcontractor User</h2>

                <div style={styles.grid}>
                  <select
                    style={styles.input}
                    value={subcontractorId}
                    onChange={(e) => {
                      setSubcontractorId(e.target.value);
                      setEmployeeId("");
                    }}
                  >
                    <option value="">Choose subcontractor</option>
                    {data.subcontractors.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>

                  <select
                    style={styles.input}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    disabled={!subcontractorId}
                  >
                    <option value="">Choose directly-employed person</option>
                    {eligibleEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.full_name}
                        {employee.email ? ` · ${employee.email}` : " · NO EMAIL"}
                        {data.subcontractorUsers.some(
                          (row) => row.employee_id === employee.id && row.active
                        )
                          ? " · PORTAL ACTIVE"
                          : ""}
                      </option>
                    ))}
                  </select>

                  <select
                    style={styles.input}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="subcontractor_admin">Subcontractor Admin</option>
                    <option value="dispatcher">Dispatcher</option>
                    <option value="driver">Driver</option>
                    <option value="accounts">Accounts</option>
                  </select>
                </div>

                <button
                  style={styles.button}
                  disabled={busy || !employeeId}
                  onClick={() =>
                    void send({
                      type: "subcontractor",
                      tenantId: tenant.writeTenantId,
                      employeeId,
                      role,
                    })
                  }
                >
                  {busy ? "Working..." : "Invite Subcontractor User"}
                </button>
              </section>
            </>
          )}
        </div>
      </main>
    </TenantGate>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 30,
    background: "#f8fafc",
  },
  container: {
    maxWidth: 1000,
    margin: "0 auto",
  },
  title: {
    marginBottom: 6,
  },
  muted: {
    color: "#64748b",
  },
  message: {
    background: "white",
    border: "1px solid #e2e8f0",
    padding: 12,
    borderRadius: 10,
    margin: "18px 0",
  },
  card: {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
  },
  grid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    marginBottom: 12,
  },
  button: {
    padding: "11px 16px",
    border: "none",
    borderRadius: 10,
    background: "#2563eb",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
};
