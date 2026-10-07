"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
/* Types only: lib/tracking's runtime modules are server-side (node:crypto). */
import type { TrackingPayload } from "../../../lib/tracking/publicPayload";

const TrackMap = dynamic(() => import("./TrackMap"), { ssr: false });

const POLL_MS = 60_000;
/* Switching back to the tab reloads, unless a load started this recently. */
const VISIBLE_RELOAD_MIN_MS = 15_000;
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const t = (iso: string) => timeFmt.format(new Date(iso));

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; data: TrackingPayload }
  | { kind: "ended"; message: string }
  | { kind: "error"; message: string };

/*
  Polls /api/public/track/[token] every minute while the tab is visible. A
  404 means the link has ended (or never existed: the route does not say
  which), so polling stops. A transient failure keeps the last good view.
*/
export default function TrackingView({ token }: { token: string }) {
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const ended = useRef(false);
  const lastLoadStart = useRef(0);

  const load = useCallback(async () => {
    if (ended.current) return;
    lastLoadStart.current = Date.now();
    try {
      const response = await fetch(`/api/public/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      const message = typeof body?.error === "string" ? body.error : null;
      if (response.status === 404) {
        ended.current = true;
        setState({ kind: "ended", message: message ?? "This tracking link has ended." });
      } else if (!response.ok) {
        setState((s) => (s.kind === "ok" ? s : { kind: "error", message: message ?? "Tracking is unavailable right now." }));
      } else {
        setState({ kind: "ok", data: body as TrackingPayload });
      }
    } catch {
      setState((s) => (s.kind === "ok" ? s : { kind: "error", message: "No connection. Retrying." }));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadStart.current < VISIBLE_RELOAD_MIN_MS) return;
      void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (state.kind === "loading") return <Card>Loading your delivery...</Card>;
  if (state.kind === "ended" || state.kind === "error") return <Card>{state.message}</Card>;

  const d = state.data;
  return (
    <div className="grid gap-4">
      <Card>
        <div className="text-xs font-black uppercase tracking-wider text-blue-700">{d.operator.name}</div>
        <h1 className="mt-1 text-2xl font-black">{headline(d)}</h1>
        <p className="mt-2 text-slate-700">{detail(d)}</p>
      </Card>
      {d.state === "next" && d.position && d.destination ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <TrackMap position={d.position} destination={d.destination} />
        </div>
      ) : null}
      <p className="text-center text-xs text-slate-500">Updates every minute. Times are UK time.</p>
    </div>
  );
}

function headline(d: TrackingPayload): string {
  if (d.state === "delivered") return d.deliveredAt ? `Delivered at ${t(d.deliveredAt)}` : "Delivered";
  if (d.state === "next") return d.etaLive ? `Arriving around ${t(d.etaLive)}` : "Your delivery is next";
  if (d.state === "scheduled") return "Your delivery is scheduled";
  return "Out for delivery";
}

function detail(d: TrackingPayload): string {
  if (d.state === "delivered") return "Thank you.";
  const window = d.etaWindow ? `Expected between ${t(d.etaWindow.from)} and ${t(d.etaWindow.to)}.` : "";
  if (d.state === "next") return d.etaLive ? "The driver is on the way to you." : window || "The driver is on the way to you.";
  if (d.state === "scheduled") return d.etaWindow ? `${dayFmt.format(new Date(d.etaWindow.from))}. ${window}` : "We will update this page on the day.";
  const before =
    d.stopsBefore !== null && d.stopsBefore > 0 ? ` ${d.stopsBefore} deliver${d.stopsBefore === 1 ? "y" : "ies"} before yours.` : "";
  return (window || "Out for delivery today.") + before;
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
