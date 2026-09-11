"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";
import {
  activitySourceLabel,
  MANUAL_ACTIVITY_KINDS,
  type ManualActivityKind,
} from "../../lib/tachograph/manualActivity";
import {
  OPERATOR_TIME_ZONE,
} from "../../lib/time";
import {
  planningStartForLocalDate,
} from "../../lib/planning/planningDriverActivity";
import type {
  TachographProviderDescriptor,
} from "../../lib/tachograph/provider";

type Driver = {
  id: string;
  name: string | null;
  driver_type: string | null;
};

type ActivityLog = {
  id: string;
  driver_id: string;
  activity_type: string | null;
  activity_kind: ManualActivityKind | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  source_kind: string | null;
  source_provider: string | null;
};

type ActivityForm = {
  activityId: string | null;
  kind: ManualActivityKind;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

const EMPTY_FORM: ActivityForm = {
  activityId: null,
  kind: "driving",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
};

const inputClasses =
  "h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink";

function localParts(
  iso: string,
  timeZone: string
): { date: string; time: string } {
  const date = new Date(iso);

  const formatter = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  );

  const parts = new Map(
    formatter
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return {
    date:
      `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
    time:
      `${parts.get("hour")}:${parts.get("minute")}`,
  };
}

function formatStamp(
  iso: string,
  timeZone: string
): string {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(new Date(iso));
}

export default function TachographPage() {
  const supabase = useMemo(
    () => createClient(),
    []
  );

  const tenant = useTenant();

  const [drivers, setDrivers] =
    useState<Driver[]>([]);

  const [selectedDriverId, setSelectedDriverId] =
    useState("");

  const [logs, setLogs] =
    useState<ActivityLog[]>([]);

  const [providers, setProviders] =
    useState<TachographProviderDescriptor[]>([]);

  const [selectedProviderId, setSelectedProviderId] =
    useState("");

  const [form, setForm] =
    useState<ActivityForm>(EMPTY_FORM);

  const [timeZone, setTimeZone] =
    useState(OPERATOR_TIME_ZONE);

  const [loadingDrivers, setLoadingDrivers] =
    useState(true);

  const [loadingLogs, setLoadingLogs] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [syncing, setSyncing] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  const selectedDriver = drivers.find(
    (driver) => driver.id === selectedDriverId
  ) ?? null;

  const selectedProvider = providers.find(
    (provider) =>
      provider.id === selectedProviderId
  ) ?? null;

  const canEdit =
    tenant.role === "admin" ||
    tenant.role === "super_admin";

  const loadDrivers = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoadingDrivers(true);
    setErrorMessage("");

    const [
      driverResult,
      profileResult,
    ] = await Promise.all([
      tenant
        .filterByTenant(
          supabase
            .from("drivers")
            .select("id, name, driver_type")
        )
        .eq("active", true)
        .order("name", { ascending: true }),

      tenant
        .filterByTenant(
          supabase
            .from("company_profiles")
            .select("timezone")
        )
        .maybeSingle(),
    ]);

    if (driverResult.error) {
      setDrivers([]);
      setErrorMessage(
        driverResult.error.message
      );
    } else {
      const rows =
        (driverResult.data as Driver[]) ?? [];

      setDrivers(rows);

      setSelectedDriverId(
        (current) =>
          current || rows[0]?.id || ""
      );
    }

    if (
      !profileResult.error &&
      typeof profileResult.data?.timezone === "string" &&
      profileResult.data.timezone
    ) {
      setTimeZone(
        profileResult.data.timezone
      );
    }

    setLoadingDrivers(false);
  }, [
    supabase,
    tenant,
  ]);

  const loadLogs = useCallback(async () => {
    if (
      tenant.status !== "ready" ||
      !selectedDriverId
    ) {
      setLogs([]);
      return;
    }

    setLoadingLogs(true);
    setErrorMessage("");

    const query = supabase
      .from("driver_activity_logs")
      .select(`
        id,
        driver_id,
        activity_type,
        activity_kind,
        start_time,
        end_time,
        duration_minutes,
        source_kind,
        source_provider
      `)
      .eq("driver_id", selectedDriverId)
      .order("start_time", {
        ascending: false,
      })
      .limit(500);

    const { data, error } =
      await tenant.filterByTenant(query);

    if (error) {
      setLogs([]);
      setErrorMessage(error.message);
    } else {
      setLogs(
        (data as ActivityLog[]) ?? []
      );
    }

    setLoadingLogs(false);
  }, [
    selectedDriverId,
    supabase,
    tenant,
  ]);

  const loadProviders = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/tachograph/providers",
        { cache: "no-store" }
      );

      const body =
        await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error ??
            "Unable to load tachograph providers."
        );
      }

      const rows =
        (body?.providers ??
          []) as TachographProviderDescriptor[];

      setProviders(rows);

      setSelectedProviderId(
        (current) =>
          current || rows[0]?.id || ""
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load tachograph providers."
      );
    }
  }, []);

  useEffect(() => {
    void loadDrivers();
    void loadProviders();
  }, [
    loadDrivers,
    loadProviders,
  ]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function editActivity(
    activity: ActivityLog
  ) {
    if (activity.source_kind !== "manual") {
      setErrorMessage(
        "Imported tachograph records are read-only. Create a separate manual correction instead."
      );
      return;
    }

    const start =
      localParts(activity.start_time, timeZone);

    const end =
      localParts(activity.end_time, timeZone);

    setForm({
      activityId: activity.id,
      kind:
        activity.activity_kind ??
        "unknown",
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function saveActivity(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");
    setErrorMessage("");

    if (!canEdit) {
      setErrorMessage(
        "Only an administrator can edit manual driver activity."
      );
      return;
    }

    if (
      tenant.status !== "ready" ||
      !tenant.writeTenantId ||
      !selectedDriverId
    ) {
      setErrorMessage(
        "Select a tenant and driver first."
      );
      return;
    }

    if (
      !form.startDate ||
      !form.startTime ||
      !form.endDate ||
      !form.endTime
    ) {
      setErrorMessage(
        "Enter start and end date/time."
      );
      return;
    }

    const start =
      planningStartForLocalDate(
        form.startDate,
        `${form.startTime}:00`,
        timeZone
      );

    const end =
      planningStartForLocalDate(
        form.endDate,
        `${form.endTime}:00`,
        timeZone
      );

    if (!start || !end) {
      setErrorMessage(
        "One of the local times is invalid in the company timezone."
      );
      return;
    }

    if (end <= start) {
      setErrorMessage(
        "Activity end must be after its start."
      );
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/tachograph/activity",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            tenantId:
              tenant.writeTenantId,
            driverId:
              selectedDriverId,
            activityId:
              form.activityId,
            activityKind:
              form.kind,
            activityType:
              form.kind,
            startTime:
              start.toISOString(),
            endTime:
              end.toISOString(),
          }),
        }
      );

      const body =
        await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error ??
            "Unable to save activity."
        );
      }

      setMessage(
        form.activityId
          ? "Manual activity updated."
          : "Manual activity added."
      );

      resetForm();
      await loadLogs();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save activity."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteActivity(
    activity: ActivityLog
  ) {
    if (
      !canEdit ||
      activity.source_kind !== "manual"
    ) {
      return;
    }

    if (
      tenant.status !== "ready" ||
      !tenant.writeTenantId
    ) {
      return;
    }

    if (
      !window.confirm(
        "Delete this manual driver activity?"
      )
    ) {
      return;
    }

    setMessage("");
    setErrorMessage("");

    const response = await fetch(
      "/api/tachograph/activity",
      {
        method: "DELETE",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          tenantId:
            tenant.writeTenantId,
          activityId:
            activity.id,
        }),
      }
    );

    const body =
      await response.json().catch(() => null);

    if (!response.ok) {
      setErrorMessage(
        body?.error ??
          "Unable to delete activity."
      );
      return;
    }

    setMessage(
      "Manual activity deleted."
    );

    await loadLogs();
  }

  async function providerAction(
    mode: "test" | "sync"
  ) {
    if (!selectedProvider) {
      setErrorMessage(
        "No tachograph API provider is configured."
      );
      return;
    }

    if (
      tenant.status !== "ready" ||
      !tenant.writeTenantId ||
      !canEdit
    ) {
      setErrorMessage(
        "Only a tenant administrator can use tachograph synchronisation."
      );
      return;
    }

    setSyncing(true);
    setMessage("");
    setErrorMessage("");

    try {
      const response = await fetch(
        "/api/tachograph/sync",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            tenantId:
              tenant.writeTenantId,
            providerId:
              selectedProvider.id,
            mode,
          }),
        }
      );

      const body =
        await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          body?.error ??
            "Tachograph provider request failed."
        );
      }

      setMessage(
        body?.message ??
          "Tachograph provider request completed."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Tachograph provider request failed."
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">
              Compliance
            </div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Tachograph
            </h1>

            <p className="m-0 text-sm text-ink-3">
              Driver activity ledger, tachograph imports,
              Drivers' Hours and WTD planning inputs.
            </p>
          </header>

          <MessageBanner tone="danger">
            {errorMessage}
          </MessageBanner>

          <MessageBanner tone="neutral">
            {message}
          </MessageBanner>

          <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
            <h2 className="m-0 text-md font-semibold text-ink">
              Driver activity
            </h2>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-ink-2">
                  Driver
                </span>

                {loadingDrivers ? (
                  <Skeleton h="2.5rem" />
                ) : (
                  <select
                    className={inputClasses}
                    value={selectedDriverId}
                    onChange={(event) => {
                      setSelectedDriverId(
                        event.target.value
                      );
                      resetForm();
                    }}
                  >
                    <option value="">
                      Select driver
                    </option>

                    {drivers.map((driver) => (
                      <option
                        key={driver.id}
                        value={driver.id}
                      >
                        {driver.name ??
                          "Unnamed driver"}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
                <strong className="block text-ink">
                  {selectedDriver?.name ??
                    "No driver selected"}
                </strong>

                <span className="text-ink-3">
                  Timezone: {timeZone}
                </span>
              </div>
            </div>
          </section>

          {canEdit && selectedDriver ? (
            <form
              onSubmit={saveActivity}
              className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="m-0 text-md font-semibold text-ink">
                    {form.activityId
                      ? "Edit manual activity"
                      : "Add manual activity"}
                  </h2>

                  <p className="m-0 mt-1 text-xs text-ink-3">
                    Manual records remain visibly manual and
                    are not presented as tachograph downloads.
                  </p>
                </div>

                {form.activityId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={resetForm}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    Activity
                  </span>

                  <select
                    className={inputClasses}
                    value={form.kind}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        kind:
                          event.target.value as ManualActivityKind,
                      })
                    }
                  >
                    {MANUAL_ACTIVITY_KINDS.map(
                      (item) => (
                        <option
                          key={item.value}
                          value={item.value}
                        >
                          {item.label}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    Start date
                  </span>

                  <input
                    type="date"
                    className={inputClasses}
                    value={form.startDate}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        startDate:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    Start time
                  </span>

                  <input
                    type="time"
                    className={inputClasses}
                    value={form.startTime}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        startTime:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    End date
                  </span>

                  <input
                    type="date"
                    className={inputClasses}
                    value={form.endDate}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        endDate:
                          event.target.value,
                      })
                    }
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-ink-2">
                    End time
                  </span>

                  <input
                    type="time"
                    className={inputClasses}
                    value={form.endTime}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        endTime:
                          event.target.value,
                      })
                    }
                  />
                </label>
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : form.activityId
                      ? "Update activity"
                      : "Add activity"}
                </Button>
              </div>
            </form>
          ) : null}

          <section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
            <h2 className="m-0 text-md font-semibold text-ink">
              Tacho API downloader
            </h2>

            <p className="m-0 mt-1 text-sm text-ink-3">
              Provider adapters run server-side. API credentials
              are not stored in browser state.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="grid min-w-[260px] gap-1.5">
                <span className="text-sm font-medium text-ink-2">
                  Provider
                </span>

                <select
                  className={inputClasses}
                  value={selectedProviderId}
                  onChange={(event) =>
                    setSelectedProviderId(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    No provider configured
                  </option>

                  {providers.map((provider) => (
                    <option
                      key={provider.id}
                      value={provider.id}
                    >
                      {provider.label}
                      {provider.configured
                        ? ""
                        : " (not configured)"}
                    </option>
                  ))}
                </select>
              </label>

              <Button
                type="button"
                variant="secondary"
                disabled={
                  syncing ||
                  !selectedProvider?.configured
                }
                onClick={() =>
                  void providerAction("test")
                }
              >
                Test connection
              </Button>

              <Button
                type="button"
                disabled={
                  syncing ||
                  !selectedProvider?.configured
                }
                onClick={() =>
                  void providerAction("sync")
                }
              >
                {syncing
                  ? "Synchronising..."
                  : "Sync tachograph"}
              </Button>
            </div>

            {providers.length === 0 ? (
              <p className="mt-3 text-sm text-ink-3">
                No vendor adapter is installed yet. The provider
                interface is now ready for a downloader plugin once
                the tachograph supplier/API is selected.
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-md font-semibold text-ink">
                  Activity ledger
                </h2>

                <p className="m-0 mt-1 text-xs text-ink-3">
                  Imported records are read-only. Manual corrections
                  remain separate for auditability.
                </p>
              </div>

              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadLogs()}
                disabled={
                  loadingLogs ||
                  !selectedDriverId
                }
              >
                Refresh
              </Button>
            </div>

            {loadingLogs ? (
              <div className="mt-3 grid gap-2">
                {Array.from(
                  { length: 4 },
                  (_, index) => (
                    <Skeleton
                      key={index}
                      h="4rem"
                    />
                  )
                )}
              </div>
            ) : logs.length === 0 ? (
              <p className="mt-4 text-sm text-ink-3">
                No activity records for this driver.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {logs.map((activity) => {
                  const manual =
                    activity.source_kind ===
                    "manual";

                  return (
                    <article
                      key={activity.id}
                      className="rounded-md border border-line bg-surface-2 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong className="text-sm font-semibold text-ink">
                            {activity.activity_kind ??
                              activity.activity_type ??
                              "Unknown"}
                          </strong>

                          <div className="mt-1 font-mono text-sm text-ink-2">
                            {formatStamp(
                              activity.start_time,
                              timeZone
                            )}
                            {" ? "}
                            {formatStamp(
                              activity.end_time,
                              timeZone
                            )}
                          </div>

                          <div className="mt-1 text-xs text-ink-3">
                            {Math.round(
                              activity.duration_minutes ??
                                0
                            )}{" "}
                            min ?{" "}
                            {activitySourceLabel(
                              activity.source_kind,
                              activity.source_provider
                            )}
                          </div>
                        </div>

                        {canEdit && manual ? (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                editActivity(
                                  activity
                                )
                              }
                            >
                              Edit
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                void deleteActivity(
                                  activity
                                )
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </TenantGate>
  );
}
