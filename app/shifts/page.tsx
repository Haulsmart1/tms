"use client";

/*
  /shifts: what the fleet is doing today, and the recorded-hours history.
  Reads go through the browser client and RLS; writes (office start, end and
  corrections) go through /api/shifts, which authorizes the caller. Recorded
  hours are what drivers logged, not a legal hours calculation.
*/

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MessageBanner from "../../components/MessageBanner";
import Tabs from "../../components/Tabs";
import { loadCompanyTimeZone, type CompanyTimeZone } from "../../lib/planning/companyTimeZone";
import { createClient } from "../../lib/supabase/browser";
import { applyTenantFilter } from "../../lib/tenant/filter";
import { OPERATOR_TIME_ZONE } from "../../lib/time";
import TenantGate from "../components/TenantGate";
import { useTenant } from "../components/TenantProvider";
import FleetTodayTab from "./FleetTodayTab";
import HistoryTab from "./HistoryTab";
import { StartShiftDialog, ShiftTimeDialog, type DriverOption, type ShiftTimeMode, type ShiftTimeTarget } from "./ShiftDialogs";

type TabId = "today" | "history";

const READ_ONLY_MESSAGE =
  "Pick one tenant in the header to start, end or correct shifts. With All tenants selected, Shifts is read-only.";

export default function ShiftsPage() {
  return (
    <Suspense fallback={<div className="ds min-h-screen bg-canvas font-sans text-ink" />}>
      <ShiftsView />
    </Suspense>
  );
}

function ShiftsView() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();
  const router = useRouter();
  const pathname = usePathname();
  const tab: TabId = useSearchParams().get("tab") === "history" ? "history" : "today";

  const tenantKey = tenant.activeTenantId ?? `all:${tenant.tenants.map((t) => t.id).join(",")}`;
  const [zone, setZone] = useState<{ key: string; value: CompanyTimeZone } | null>(null);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState<{ target: ShiftTimeTarget; mode: ShiftTimeMode } | null>(null);

  useEffect(() => {
    if (tenant.status !== "ready") return;
    let cancelled = false;
    const ids = tenant.activeTenantId ? [tenant.activeTenantId] : tenant.tenants.map((t) => t.id);
    void loadCompanyTimeZone(supabase, ids).then((value) => {
      if (!cancelled) setZone({ key: tenantKey, value });
    });
    return () => {
      cancelled = true;
    };
    // tenantKey covers activeTenantId and the tenant list.
  }, [supabase, tenant.status, tenantKey]);

  useEffect(() => {
    if (tenant.status !== "ready") return;
    let cancelled = false;
    void applyTenantFilter(supabase.from("drivers").select("id, name"), tenant.activeTenantId)
      .eq("active", true)
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("[shifts] drivers load failed", error);
        setDrivers(((data ?? []) as { id: string; name: string | null }[]).map((d) => ({ id: d.id, name: d.name?.trim() || "Unnamed driver" })));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, tenant.status, tenant.activeTenantId]);

  const zoneReady = zone !== null && zone.key === tenantKey;
  const timeZone = zoneReady ? zone.value.timeZone : OPERATOR_TIME_ZONE;
  const writeTenantId = tenant.status === "ready" ? tenant.writeTenantId : null;
  const canWrite = writeTenantId !== null;

  function selectTab(id: string) {
    const next = id === "history" ? "history" : "today";
    router.replace(next === "today" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  function done(message: string) {
    setStartOpen(false);
    setTimeTarget(null);
    setNotice(message);
    setReloadKey((k) => k + 1);
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-6xl px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-2">Operations</div>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">Shifts</h1>
            <p className="mt-1 text-sm text-ink-2">Walkaround checks, who is on shift, and recorded hours.</p>
          </header>

          <div className="mb-4">
            <Tabs
              label="Shift views"
              activeId={tab}
              onChange={selectTab}
              tabs={[
                { id: "today", label: "Fleet today" },
                { id: "history", label: "History" },
              ]}
            />
          </div>

          <MessageBanner tone="info">{tenant.status === "ready" && !canWrite ? READ_ONLY_MESSAGE : null}</MessageBanner>
          <MessageBanner tone="warning">{zoneReady ? zone.value.note : null}</MessageBanner>
          <MessageBanner tone="success">{notice || null}</MessageBanner>

          {tenant.status === "ready" ? (
            tab === "today" ? (
              <FleetTodayTab
                supabase={supabase}
                tenantStatus={tenant.status}
                activeTenantId={tenant.activeTenantId}
                timeZone={timeZone}
                zoneReady={zoneReady}
                canWrite={canWrite}
                reloadKey={reloadKey}
                onStartShift={() => {
                  setNotice("");
                  setStartOpen(true);
                }}
                onEndShift={(target) => {
                  setNotice("");
                  setTimeTarget({ target, mode: "end" });
                }}
              />
            ) : (
              <HistoryTab
                supabase={supabase}
                tenantStatus={tenant.status}
                activeTenantId={tenant.activeTenantId}
                timeZone={timeZone}
                zoneReady={zoneReady}
                canWrite={canWrite}
                drivers={drivers}
                reloadKey={reloadKey}
                onShiftTime={(target, mode) => {
                  setNotice("");
                  setTimeTarget({ target, mode });
                }}
              />
            )
          ) : null}

          <p className="mt-6 text-xs text-ink-2">
            Recorded hours as logged by drivers. Tachograph data remains the legal record of driving time; no Working
            Time or rest-period check is made here.
          </p>
        </main>

        {writeTenantId ? (
          <StartShiftDialog
            open={startOpen}
            onClose={() => setStartOpen(false)}
            onDone={done}
            tenantId={writeTenantId}
            drivers={drivers}
            timeZone={timeZone}
          />
        ) : null}
        <ShiftTimeDialog
          target={canWrite ? timeTarget?.target ?? null : null}
          mode={timeTarget?.mode ?? "end"}
          onClose={() => setTimeTarget(null)}
          onDone={done}
          timeZone={timeZone}
        />
      </div>
    </TenantGate>
  );
}
