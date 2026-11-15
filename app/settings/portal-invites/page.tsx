"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Card from "../../../components/Card";
import Field from "../../../components/Field";
import Select from "../../../components/Select";
import Button from "../../../components/Button";
import { tenantDataView } from "../../../lib/loading/tenantDataView";

type Driver = {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
};

type Subcontractor = {
  id: string;
  name: string;
  active?: boolean;
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
  driverUsers: Array<{ id: string; driver_id: string; active: boolean }>;
  subcontractorUsers: Array<{ id: string; employee_id: string; role: string; active: boolean }>;
};

const roleLabels: Record<string, string> = {
  subcontractor_admin: "Subcontractor Admin",
  dispatcher: "Dispatcher",
  driver: "Driver",
  accounts: "Accounts",
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

  const [filter, setFilter] = useState("");
  const [driverId, setDriverId] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("subcontractor_admin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  /* Separate from `message`, which also carries invite results. Only a failed
     READ may keep the controls disabled. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

  const loadData = useCallback(async () => {
    if (tenant.status !== "ready" || !canManage) return;   // stay in the loading view

    if (!tenant.activeTenantId) {
      // A resolved admin on "All tenants". Nothing is coming, and the view
      // says so rather than leaving silently empty dropdowns on screen.
      setLoadFailed(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadFailed(false);

    try {
      const response = await fetch(
        `/api/settings/portal-invites?tenantId=${encodeURIComponent(
          tenant.activeTenantId
        )}`,
        { cache: "no-store" }
      );

      const body = await response.json();

      if (!response.ok) {
        setMessage(body.error || "Unable to load invite data.");
        setLoadFailed(true);
        return;
      }

      setData(body);
      setDataTenantId(tenant.activeTenantId);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load invite data."
      );
      setLoadFailed(true);
    } finally {
      // Every exit path, or the error branch's early `return` above would
      // leave the controls disabled forever.
      setLoading(false);
    }
  }, [tenant.status, tenant.activeTenantId, canManage]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* NO SKELETONS ON THIS PAGE, DELIBERATELY. This route is on
     SKELETON_READY_ROUTES, and its checklist step 3 ("every region that reads
     data renders a skeleton") is satisfied by exclusion, not by omission: the
     only regions here that read data are <select> options, and a select is a
     fixed-size control whose options are invisible until it is opened, so it
     carries no data on screen to grey out. Same rule that leaves CustomerCard's
     buttons rendering real-but-disabled. What this page does instead is disable
     the controls until the fetch resolves, so they cannot be submitted while
     they are still, wrongly, empty. */
  const view = tenantDataView({
    tenantStatus: tenant.status,
    activeTenantId: tenant.activeTenantId,
    fetching: loading,
    hasData: data.drivers.length > 0 || data.subcontractors.length > 0,
    dataTenantId,
    failed: loadFailed,
  });

  /* This page has no list, so tenantDataView's list/empty distinction
     collapses: both mean resolved, not failed, not mid-fetch, so the form is
     usable. A tenant with genuinely no drivers still gets working controls,
     just with nothing in them, which is the honest rendering of that state. */
  const controlsEnabled = view === "list" || view === "empty";

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

  async function send(payload: object, method: "POST" | "PATCH" = "POST") {
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/settings/portal-invites", {
        method,
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

  const search = filter.trim().toLowerCase();
  const matches = (...values: Array<string | null | undefined>) =>
    values.some((value) => value?.toLowerCase().includes(search));
  const accessRows = [
    ...data.driverUsers.flatMap((link) => {
      const person = data.drivers.find((driver) => driver.id === link.driver_id);
      return person ? [{ ...link, name: person.name, email: person.email,
        company: null, role: "driver", type: "driver", eligible: person.active !== false }] : [];
    }),
    ...data.subcontractorUsers.flatMap((link) => {
      const person = data.employees.find((employee) => employee.id === link.employee_id);
      const company = data.subcontractors.find((sub) => sub.id === person?.subcontractor_id);
      return person ? [{ ...link, name: person.full_name, email: person.email,
        company: company?.name, role: link.role, type: "subcontractor",
        eligible: company?.active === true && person.active && person.directly_employed &&
          (!person.employment_end_date || person.employment_end_date >= new Date().toISOString().slice(0, 10)) }] : [];
    }),
  ].filter((row) => matches(row.name, row.email, row.company, roleLabels[row.role]));

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1000px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Invitation Control Board</h1>
            <p className="m-0 text-sm text-ink-3">
              Invite drivers and directly employed subcontractor staff. Review or remove their portal access.
            </p>
          </header>

          <MessageBanner tone="neutral">{message}</MessageBanner>

          {view === "no-tenant-selected" ? (
            <div className="mb-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
              Portal invites are sent one tenant at a time. Pick a tenant from
              the selector in the header to invite its drivers and
              subcontractors.
            </div>
          ) : null}

          {view === "loading" ? (
            <span className="sr-only" role="status">Loading invite options</span>
          ) : null}

          {/* view === "error" renders nothing extra, deliberately: the failure
              is already on screen in the MessageBanner above, and a second copy
              would be noise. The branch's job is done by controlsEnabled, which
              is false for "error" and so keeps the still-empty selects
              unusable. */}

          {!canManage ? (
            <Card>Only tenant admins can manage invites.</Card>
          ) : (
            <>
              {controlsEnabled ? (
                <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="mb-3 text-md font-semibold text-ink">Portal access</h2>
                  <Field id="portal-access-search" label="Find by name, email, company or role"
                    value={filter} onChange={(event) => setFilter(event.target.value)} />
                  {accessRows.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead><tr>
                          <th scope="col" className="p-2">Account</th>
                          <th scope="col" className="p-2">Role</th>
                          <th scope="col" className="p-2">Access</th>
                          <th scope="col" className="p-2">Action</th>
                        </tr></thead>
                        <tbody>
                          {accessRows.map((row) => (
                            <tr key={row.id} className="border-t border-line">
                              <td className="p-2">{row.name}<div className="text-ink-3">{row.email}</div>
                                {row.company ? <div className="text-ink-3">{row.company}</div> : null}</td>
                              <td className="p-2">{roleLabels[row.role] ?? row.role}</td>
                              <td className="p-2">{!row.active ? "Revoked" : row.eligible ? "Enabled" : "Record inactive or ineligible"}</td>
                              <td className="p-2">{row.active ? (
                                <Button type="button" variant="secondary" size="sm" disabled={busy}
                                  aria-label={`Revoke portal access for ${row.name}`}
                                  onClick={() => {
                                    if (window.confirm(`Revoke portal access for ${row.name}?`)) {
                                      void send({ tenantId: tenant.activeTenantId, type: row.type, linkId: row.id }, "PATCH");
                                    }
                                  }}>Revoke access</Button>
                              ) : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="mt-3 text-sm text-ink-3">{search ? "No matching portal accounts." : "No portal accounts yet."}</p>}
                </section>
              ) : null}
              <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-3 text-md font-semibold text-ink">Invite Driver</h2>

                <Select
                  id="portal-invite-driver"
                  label="Driver"
                  wrapperClassName="mb-3"
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  disabled={!controlsEnabled}
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
                </Select>

                <Button
                  disabled={busy || !controlsEnabled || !driverId}
                  onClick={() =>
                    void send({
                      type: "driver",
                      tenantId: tenant.activeTenantId,
                      driverId,
                    })
                  }
                >
                  {busy ? "Working..." : "Invite Driver"}
                </Button>
              </section>

              <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-3 text-md font-semibold text-ink">Invite Subcontractor User</h2>

                <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Select
                    id="portal-invite-subcontractor"
                    label="Subcontractor"
                    value={subcontractorId}
                    onChange={(e) => {
                      setSubcontractorId(e.target.value);
                      setEmployeeId("");
                    }}
                    disabled={!controlsEnabled}
                  >
                    <option value="">Choose subcontractor</option>
                    {data.subcontractors.filter((sub) => sub.active === true).map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </Select>

                  <Select
                    id="portal-invite-employee"
                    label="Directly-Employed Person"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    disabled={!controlsEnabled || !subcontractorId}
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
                  </Select>

                  <Select
                    id="portal-invite-role"
                    label="Role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={!controlsEnabled}
                  >
                    <option value="subcontractor_admin">Subcontractor Admin</option>
                    <option value="dispatcher">Dispatcher</option>
                    <option value="driver">Driver</option>
                    <option value="accounts">Accounts</option>
                  </Select>
                </div>

                <Button
                  disabled={busy || !controlsEnabled || !employeeId}
                  onClick={() =>
                    void send({
                      type: "subcontractor",
                      tenantId: tenant.activeTenantId,
                      employeeId,
                      role,
                    })
                  }
                >
                  {busy ? "Working..." : "Invite Subcontractor User"}
                </Button>
              </section>
            </>
          )}
        </main>
      </div>
    </TenantGate>
  );
}
