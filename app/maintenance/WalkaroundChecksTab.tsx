"use client";

/*
  The Walkaround checks tab on /maintenance: one day's checks for the selected
  tenant, the objections waiting for an admin, and the detail of any check.
  Read-only apart from objection decisions, which go through
  PATCH /api/walkaround/objections/[id].
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import DataTable, { type Column } from "../../components/DataTable";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Select from "../../components/Select";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { loadCompanyTimeZone } from "../../lib/planning/companyTimeZone";
import { operatorDayWindow } from "../../lib/shifts/fleetQuery";
import { clockIn, dateTimeIn } from "../../lib/shifts/zonedTime";
import { useTenant } from "../components/TenantProvider";
import { OPERATOR_TIME_ZONE, operatorDayInTimeZone } from "../../lib/time";
import { PHASE_LABELS, RESULT_LABELS } from "../../lib/walkaround/checkView";
import {
  loadChecksInRange,
  loadPendingObjections,
  type CheckSummary,
  type PendingObjection,
} from "../../lib/walkaround/checksQuery";
import CheckDetailPanel from "./CheckDetailPanel";
import { resultTone } from "./walkaroundTones";

type Loaded = { checks: CheckSummary[]; objections: PendingObjection[] };

export default function WalkaroundChecksTab({ supabase }: { supabase: SupabaseClient }) {
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";
  const tenantKey = tenant.activeTenantId ?? `all:${tenant.tenants.map((t) => t.id).join(",")}`;

  const [zone, setZone] = useState<{ key: string; timeZone: string; note: string | null } | null>(null);
  const [day, setDay] = useState(() => operatorDayInTimeZone(new Date(), OPERATOR_TIME_ZONE));
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [errorText, setErrorText] = useState("");
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [openCheckId, setOpenCheckId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (tenant.status !== "ready") return;
    let cancelled = false;
    const ids = tenant.activeTenantId ? [tenant.activeTenantId] : tenant.tenants.map((t) => t.id);
    void loadCompanyTimeZone(supabase, ids).then((z) => {
      if (cancelled) return;
      setZone({ key: tenantKey, timeZone: z.timeZone, note: z.note });
      setDay(operatorDayInTimeZone(new Date(), z.timeZone));
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, tenant.status, tenantKey]);

  const zoneReady = zone !== null && zone.key === tenantKey;
  const timeZone = zoneReady ? zone.timeZone : OPERATOR_TIME_ZONE;

  const load = useCallback(async () => {
    const range = operatorDayWindow(day, timeZone);
    const mine = ++seq.current;
    if (!range) {
      setErrorText("Choose a valid day.");
      setState("error");
      return;
    }
    setState("loading");
    try {
      const [checks, objections] = await Promise.all([
        loadChecksInRange(supabase, tenant.activeTenantId, range),
        loadPendingObjections(supabase, tenant.activeTenantId),
      ]);
      if (mine !== seq.current) return;
      setLoaded({ checks, objections });
      setDataTenantId(tenant.activeTenantId);
      setState("ready");
    } catch (error) {
      if (mine !== seq.current) return;
      console.error("[maintenance] walkaround checks load failed", error);
      setErrorText(error instanceof Error ? error.message : "");
      setState("error");
    }
  }, [supabase, tenant.activeTenantId, day, timeZone]);

  useEffect(() => {
    if (tenant.status !== "ready" || !zoneReady) return;
    void load();
    return () => {
      seq.current++;
    };
  }, [tenant.status, zoneReady, load]);

  const checks = loaded?.checks ?? [];
  const vehicles = useMemo(() => [...new Map(checks.map((c) => [c.vehicleId, c.registration])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [checks]);
  const drivers = useMemo(() => [...new Map(checks.map((c) => [c.driverId, c.driverName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [checks]);
  const rows = checks.filter(
    (c) =>
      (!vehicleFilter || c.vehicleId === vehicleFilter) &&
      (!driverFilter || c.driverId === driverFilter) &&
      (!resultFilter || c.result === resultFilter),
  );

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: state === "loading",
    hasData: loaded !== null,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const columns: Column<CheckSummary>[] = [
    { header: "Time", cell: (c) => <span className="font-mono tabular-nums">{clockIn(c.performedAt, timeZone)}</span> },
    { header: "Phase", cell: (c) => PHASE_LABELS[c.phase] },
    { header: "Vehicle", cell: (c) => <span className="font-mono text-sm font-medium text-ink">{c.registration}</span> },
    { header: "Driver", cell: (c) => c.driverName },
    { header: "Result", cell: (c) => <Badge tone={resultTone(c.result)}>{RESULT_LABELS[c.result]}</Badge> },
    { header: "Odometer", align: "right", cell: (c) => (c.odometer === null ? <span className="text-ink-2">Not taken</span> : <span className="font-mono tabular-nums">{c.odometer}</span>) },
    {
      header: "Notes",
      cell: (c) => (
        <div className="grid gap-0.5 text-xs text-ink-2">
          {c.flags.includes("assigned_vehicle_mismatch") || c.mismatchReason ? (
            <span>Different vehicle: {c.mismatchReason?.trim() || "no reason given"}</span>
          ) : null}
          {c.flags.includes("late_sync") ? (
            <span>
              Synced late: happened {dateTimeIn(c.performedAt, timeZone)}, arrived {dateTimeIn(c.receivedAt, timeZone)}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  const objections = loaded?.objections ?? [];

  return (
    <div className="grid gap-4">
      <MessageBanner tone="warning">{zoneReady ? zone.note : null}</MessageBanner>

      <section aria-busy={showSkeleton} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-ink">Pending objections</h2>
        {showSkeleton ? (
          <p className="text-sm text-ink-2">Loading objections</p>
        ) : state === "error" ? (
          <p className="text-sm text-ink-2">Objections could not be loaded.</p>
        ) : objections.length === 0 ? (
          <p className="text-sm text-ink-2">No objections are waiting for a decision.</p>
        ) : (
          <ul className="grid gap-2">
            {objections.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink">
                  {o.driverName} objects to the VOR on <span className="font-mono">{o.registration}</span>: {o.defectLabel}
                  <span className="text-ink-2"> (raised {dateTimeIn(o.raisedAt, timeZone)})</span>
                </span>
                {o.checkId ? (
                  <Button size="sm" variant="secondary" onClick={() => setOpenCheckId(o.checkId)}>
                    {isAdmin ? "Review" : "View"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-busy={showSkeleton} className="grid gap-3">
        {showSkeleton ? (
          <span className="sr-only" role="status">
            Loading walkaround checks
          </span>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field id="walkaround-day" label="Day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} wrapperClassName="w-44" />
          <Select id="walkaround-vehicle" label="Vehicle" value={vehicleFilter} onChange={(e) => setVehicleFilter(e.target.value)} wrapperClassName="w-44">
            <option value="">All vehicles</option>
            {vehicles.map(([id, reg]) => (
              <option key={id} value={id}>
                {reg}
              </option>
            ))}
          </Select>
          <Select id="walkaround-driver" label="Driver" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} wrapperClassName="w-52">
            <option value="">All drivers</option>
            {drivers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Select id="walkaround-result" label="Result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} wrapperClassName="w-44">
            <option value="">All results</option>
            <option value="pass">{RESULT_LABELS.pass}</option>
            <option value="minor">{RESULT_LABELS.minor}</option>
            <option value="dangerous">{RESULT_LABELS.dangerous}</option>
          </Select>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          state={showSkeleton ? "loading" : state === "error" ? "error" : rows.length ? "ready" : "empty"}
          errorMessage={`Couldn't load walkaround checks. ${errorText ? `(${errorText})` : ""}`.trim()}
          onRetry={() => void load()}
          onRowClick={(c) => setOpenCheckId(c.id)}
          emptyTitle={checks.length ? "No checks match these filters" : "No walkaround checks on this day"}
        />
      </section>

      <CheckDetailPanel
        supabase={supabase}
        checkId={openCheckId}
        isAdmin={isAdmin}
        timeZone={timeZone}
        onClose={() => setOpenCheckId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}
