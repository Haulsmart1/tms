"use client";

import { useState } from "react";
import type { PlanningDriverSchedulePreview } from "../../lib/planning/planningDriverSchedule";
import type { PlanningServiceStop } from "../../lib/planning/physicalItinerary";
import { buildSevenDayPresentation } from "../../lib/planning/sevenDayPresentation";
import { buildEditableSevenDayPlan, moveEditablePlanRange, stopsForEditableDay, type SevenDayPlanEditorDraft } from "../../lib/planning/sevenDayPlanEditor";

export default function SevenDayPlanEditor({ preview, serviceStops, planningDate, driverId, timeZone, draft, onChange, onInspect, jobs, readOnly }: {
  preview: PlanningDriverSchedulePreview; serviceStops: PlanningServiceStop[];
  planningDate: string; driverId: string | null; timeZone: string;
  draft?: SevenDayPlanEditorDraft; onChange: (draft: SevenDayPlanEditorDraft | null) => void;
  onInspect: (jobId: string) => void;
  jobs: { id: string; reference: string | null; stops: { id: string; address_line: string | null; postcode: string | null; type: string | null }[] }[];
  readOnly: boolean;
}) {
  const ids = serviceStops.map((stop) => `stop:${stop.stopId}`);
  const signature = [planningDate, driverId ?? "", timeZone, ...ids].join("\u001f");
  const calculated = buildEditableSevenDayPlan(ids, preview);
  const active = draft?.signature === signature && draft.edited ? draft : null;
  const plan = active?.plan ?? calculated;
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [target, setTarget] = useState(1);
  const [notice, setNotice] = useState("");
  const days = buildSevenDayPresentation(preview);
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const time = (seconds: number) => formatter.format(new Date(preview.planningStart.getTime() + seconds * 1000));
  const label = (id: string) => {
    const stop = serviceStops.find((value) => `stop:${value.stopId}` === id);
    const job = jobs.find((value) => value.id === stop?.jobId);
    const rawStop = job?.stops.find((value) => value.id === stop?.stopId);
    return stop ? `Drop ${stop.serviceSequenceNumber} · ${job?.reference || stop.jobId} · ${rawStop?.type || "Stop"} · ${rawStop?.address_line || rawStop?.postcode || ""}` : id;
  };
  function move() {
    const result = moveEditablePlanRange(plan, first, last || first, target, ids.map((taskId, index) => ({ taskId, precedenceTaskIds: index ? [ids[index - 1]] : [] })));
    if (!result.ok) { setNotice(`Move refused: ${result.reason.replaceAll("_", " ")}. Canonical order must be preserved.`); return; }
    onChange({ signature, plan: result.plan, edited: true });
    setNotice("Allocation draft retained. Save a named plan to retain it across sessions. Route order and driver ETAs remain calculated from the canonical itinerary.");
  }
  return <section aria-label="Seven-day plan editor" className="mt-3 space-y-3">
    <h3 className="text-sm font-semibold">Seven-day route</h3>
    <p className="text-xs text-ink-3">Days are driver duty periods, not midnight boundaries. Travel can span days. Use lane ordering or Smart Optimize to change the canonical route, then Save / Apply plan to publish it.</p>
    {active ? <p role="status" className="text-xs text-warning">Edited allocation draft — requires scheduling review. These moves do not change the driver schedule, published dates or route order.</p> : null}
    <div className="flex flex-wrap gap-2 text-xs">
      <label>First stop <select value={first} onChange={(event) => setFirst(event.target.value)}><option value="">Select stop</option>{ids.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>
      <label>Last stop <select value={last} onChange={(event) => setLast(event.target.value)}><option value="">Same stop</option>{ids.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></label>
      <label>Move to <select value={target} onChange={(event) => setTarget(Number(event.target.value))}>{[1,2,3,4,5,6,7,0].map((day) => <option key={day} value={day}>{day ? `Day ${day}` : "Remaining work"}</option>)}</select></label>
      <button type="button" disabled={readOnly || !first} onClick={move}>Move range</button>
      <button type="button" disabled={readOnly || !active} onClick={() => { onChange(null); setNotice(""); }}>Use calculated allocation</button>
    </div>
    {notice ? <p role="status" className="text-xs">{notice}</p> : null}
    {[...days.map((day) => day.day), 0].map((day) => {
      const baseline = days.find((value) => value.day === day);
      const stops = stopsForEditableDay(plan, day as 0|1|2|3|4|5|6|7);
      const jobs = new Set(stops.map((stop) => serviceStops.find((value) => `stop:${value.stopId}` === stop.taskId)?.jobId));
      return <details key={day} className="rounded border border-line p-2">
        <summary className="cursor-pointer text-sm">{day ? `Day ${day}` : "Remaining / beyond seven days"} · {stops.length} stops · {jobs.size} jobs{baseline?.scheduleDay ? ` · ${time(baseline.scheduleDay.startSeconds)}` : ""}</summary>
        {baseline ? <p className="my-2 text-xs">{active ? "Calculated baseline: " : ""}{Math.round(baseline.totals.driveSeconds/60)} min driving · {Math.round(baseline.totals.serviceSeconds/60)} min service · {baseline.totals.breakCount} breaks · {baseline.totals.dailyRestCount} rests</p> : null}
        <ol className="space-y-1 text-xs">{stops.map((stop) => {
          const service = serviceStops.find((value) => `stop:${value.stopId}` === stop.taskId);
          const eta = baseline?.drops.find((value) => `stop:${value.stopId}` === stop.taskId);
          return <li key={stop.taskId}><button type="button" onClick={() => service && onInspect(service.jobId)}>{label(stop.taskId)}</button>{!active && eta ? ` · ${time(eta.serviceStartSeconds)} → ${time(eta.serviceEndSeconds)}` : ""}</li>;
        })}</ol>
        {baseline?.events.length ? <details className="mt-2 text-xs"><summary>Activity and work spanning days</summary><ol>{baseline.events.map((event, index) => <li key={index}>{event.kind.replaceAll("_", " ")} · {event.taskId ? label(event.taskId) : ""} · {time(event.startSeconds)} → {time(event.endSeconds)}</li>)}</ol></details> : null}
      </details>;
    })}
  </section>;
}
