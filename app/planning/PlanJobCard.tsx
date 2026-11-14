"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { isRoutable, sortedStops } from "../../lib/planning/waypoints";
import type { PlanJob } from "../../lib/planning/types";
import { planningJobProgress } from "../../lib/planning/jobProgress";

import { COLLECTION_FAILURE_REASONS, isCollectionFailureReason, type CollectionFailureReason } from "../../lib/planning/collectionFailure";

export type CollectionFailure = { stopId: string; reason: CollectionFailureReason };
export type CollectionFailureUndo = { stopId: string; attemptId: string };
export type PlanSignOff = "collect" | "deliver" | "fail" | "undo-failure";
export type PlanSignOffHandler = (jobId: string, action: PlanSignOff, requestId: string, failure?: CollectionFailure | CollectionFailureUndo) => Promise<void>;

type Props = {
  job: PlanJob;
  /** 1-based position in its lane; null in the unassigned pool. */
  sequence: number | null;
  /** Canonical service Drop numbers for this job. Undefined means the lane
      currently has no canonical itinerary and sequence remains the fallback. */
  dropNumbers?: number[];
  /** True once geocoding has been attempted, so the badge means "failed",
      never "still loading". */
  geocodeSettled: boolean;
  /** Set when this job arrived assigned to a now-inactive vehicle; saving any
      change to the plan will clear that assignment. */
  note?: string;
  onDropBefore?: (draggedJobId: string) => void;
  onOpen?: (jobId: string) => void;
  onAccept?: (jobId: string) => void;
  onCollectionReceipt?: () => void;
  onAppointmentEmail?: () => void;
  onSignOff?: PlanSignOffHandler;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  readOnly?: boolean;
};

export const JOB_ID_MIME = "text/plain";

export default function PlanJobCard({
  job,
  sequence,
  dropNumbers,
  geocodeSettled,
  note,
  onDropBefore,
  onOpen,
  onAccept,
  onCollectionReceipt,
  onAppointmentEmail,
  onSignOff,
  selected = false,
  onSelectedChange,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  readOnly = false,
}: Props) {
  const dragged = useRef(false);
  const signOffLock = useRef(false);
  const signOffRequests = useRef<Record<string, string>>({});
  const [signingOff, setSigningOff] = useState<PlanSignOff | null>(null);
  const [showFailure, setShowFailure] = useState(false);
  const [failedStopId, setFailedStopId] = useState("");
  const [reason, setReason] = useState<CollectionFailureReason | "">("");
  const [signOffError, setSignOffError] = useState<string | null>(null);
  const stops = sortedStops(job);
  const failedCollections = stops.filter((stop) => stop.type === "collection" && stop.status === "failed");
  const pendingCollections = stops.filter((stop) => stop.type === "collection" &&
    !stop.collected_at && !stop.delivered_at &&
    ![stop.status, stop.pod_status].some((status) =>
      ["failed", "completed", "collected", "delivered", "cancelled", "canceled"].includes(status ?? "")));
  const failureStop = pendingCollections.find((stop) => stop.id === failedStopId) ?? pendingCollections[0];
  const first = stops[0];
  const last = stops[stops.length - 1];
  const progress = planningJobProgress(job);
  const progressClass = progress === "delivered"
    ? "border-success bg-success-tint"
    : progress === "collected" || progress === "part_collected"
      ? "border-warning bg-warning-tint"
      : "border-line bg-surface";
  const progressLabel = progress === "delivered" ? "Delivered"
    : progress === "collected" ? "Collected"
      : progress === "part_collected" ? "Part collected" : null;
  const placeSummary =
    stops.length === 0
      ? "No stops"
      : `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${first.city ?? first.postcode ?? "?"}${
          stops.length > 1 ? ` → ${last.city ?? last.postcode ?? "?"}` : ""
        }`;
  const warn = geocodeSettled && !isRoutable(job);
  const dropLabel =
    dropNumbers === undefined
      ? sequence !== null
        ? `Drop ${sequence}`
        : null
      : dropNumbers.length === 0
        ? "No mapped Drop"
        : dropNumbers.length === 1
          ? `Drop ${dropNumbers[0]}`
          : `Drops ${dropNumbers.join(", ")}`;

  async function signOff(action: PlanSignOff, failure?: CollectionFailure | CollectionFailureUndo) {
    if (!onSignOff || signOffLock.current) return;
    signOffLock.current = true;
    setSigningOff(action);
    setSignOffError(null);
    const requestKey = failure && "attemptId" in failure ? failure.attemptId : action;
    try {
      const requestId = signOffRequests.current[requestKey] ??= crypto.randomUUID();
      await onSignOff(job.id, action, requestId, failure);
      if (action === "fail") {
        setShowFailure(false);
        setReason("");
      }
      delete signOffRequests.current[requestKey];
    } catch (error) {
      setSignOffError(error instanceof Error ? error.message : "Could not save sign-off. Try again.");
    } finally {
      signOffLock.current = false;
      setSigningOff(null);
    }
  }

  const canSignOff = !readOnly && onSignOff && progress !== "delivered" &&
    !["cancelled", "canceled"].includes(job.status ?? "");
  const hasCollection = stops.some((stop) => stop.type === "collection");
  const hasDelivery = stops.some((stop) => stop.type === "delivery");

  function handleDragStart(e: DragEvent) {
    dragged.current = true;
    e.dataTransfer.setData(JOB_ID_MIME, job.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
  }

  function handleClick(e: MouseEvent) {
    e.stopPropagation();

    if (dragged.current || !onOpen) {
      return;
    }

    onOpen(job.id);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!onOpen || (e.key !== "Enter" && e.key !== " ")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    onOpen(job.id);
  }

  function handleDragOver(e: DragEvent) {
    if (onDropBefore) e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    if (!onDropBefore) return;
    e.preventDefault();
    e.stopPropagation(); // the lane's own drop handler would otherwise append
    const draggedId = e.dataTransfer.getData(JOB_ID_MIME);
    if (draggedId && draggedId !== job.id) onDropBefore(draggedId);
  }

  return (
    <div
      draggable={!readOnly}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragStart={readOnly ? undefined : handleDragStart}
      onDragEnd={readOnly ? undefined : handleDragEnd}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDrop={readOnly ? undefined : handleDrop}
      className={`min-w-0 max-w-full break-words [overflow-wrap:anywhere] rounded-md border px-2.5 py-2 text-sm shadow-sm ${progressClass} ${readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      {!readOnly && onSelectedChange ? (
        <label
          className="mb-1.5 flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-ink-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            draggable={false}
            checked={selected}
            onChange={(e) => onSelectedChange(e.currentTarget.checked)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4"
          />
          Select job
        </label>
      ) : null}

      <p className="font-semibold text-ink">
        {dropNumbers?.length ? `${dropLabel} · ` : sequence !== null && dropNumbers === undefined ? `${sequence} · ` : ""}
        {job.reference ?? "No reference"}
        {warn ? (
          <span
            className="ml-1.5 rounded border border-line px-1 text-xs font-normal text-warning"
            title="One or more stops could not be geocoded; this job is excluded from the route."
          >
            no map fix
          </span>
        ) : null}
        {note ? (
          <span
            className="ml-1.5 rounded border border-line px-1 text-xs font-normal text-warning"
            title="This job arrived assigned to an inactive vehicle. Saving any change to the plan will clear that assignment."
          >
            {note}
          </span>
        ) : null}
      </p>
      <p className="text-xs text-ink-3">
        {job.customer_name ?? "No customer"} · {placeSummary}
      </p>
      {progress !== "delivered" && failedCollections.map((stop) => {
        const failure = stop.last_failed_attempt;
        const failureReason = failure?.reason;
        const attemptId = failure?.flags?.includes("office") && failure.clientId;
        return (
          <div key={stop.id} className="mt-1 flex flex-wrap items-center gap-2"
            onClick={attemptId && canSignOff ? (event) => event.stopPropagation() : undefined}
            onKeyDown={attemptId && canSignOff ? (event) => event.stopPropagation() : undefined}>
            <p className="text-xs font-semibold text-danger">
              Unable to collect{isCollectionFailureReason(failureReason) ? ` · ${COLLECTION_FAILURE_REASONS[failureReason]}` : ""}
              {failedCollections.length > 1 ? ` · ${stop.address_line}` : ""}
            </p>
            {canSignOff && attemptId && !stop.collected_at && !stop.delivered_at && stop.pod_status === "failed" ? (
              <button type="button" disabled={signingOff !== null} draggable={false}
                aria-label={`Undo failed collection at ${stop.address_line}`}
                className="min-h-11 rounded-md border border-line px-2 text-xs font-semibold text-ink disabled:opacity-50"
                onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onClick={() => void signOff("undo-failure", { stopId: stop.id, attemptId })}>
                {signingOff === "undo-failure" ? "Undoing…" : "Undo"}
              </button>
            ) : null}
          </div>
        );
      })}
      {progressLabel ? (
        <p className={`mt-1 text-xs font-semibold ${progress === "delivered" ? "text-success" : "text-warning"}`}>
          {progressLabel}{progress === "collected" && sequence !== null ? " · On van" : ""}
        </p>
      ) : null}

      {!readOnly && sequence !== null && (onMoveUp || onMoveDown) ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {dropLabel && !dropNumbers?.length ? (
            <span className="mr-1 text-xs text-ink-3">{dropLabel}</span>
          ) : null}

          <button
            type="button"
            draggable={false}
            disabled={!canMoveUp}
            className="min-h-11 rounded border border-line px-2 py-0.5 text-xs text-ink disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMoveUp?.();
            }}
          >
            Up
          </button>

          <button
            type="button"
            draggable={false}
            disabled={!canMoveDown}
            className="min-h-11 rounded border border-line px-2 py-0.5 text-xs text-ink disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMoveDown?.();
            }}
          >
            Down
          </button>
        </div>
      ) : null}

      {canSignOff ? (
        <div className="mt-2 flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}>
          {hasCollection && progress !== "collected" ? (
            <button type="button" disabled={signingOff !== null}
              className="min-h-11 rounded-md border border-warning px-2 text-xs font-semibold text-ink disabled:opacity-50"
              onClick={() => void signOff("collect")}>
              {signingOff === "collect" ? "Saving…" : "Mark collected"}
            </button>
          ) : null}
          {hasDelivery ? (
            <button type="button" disabled={signingOff !== null || (hasCollection && progress !== "collected")}
              className="min-h-11 rounded-md border border-success px-2 text-xs font-semibold text-ink disabled:opacity-50"
              title={hasCollection && progress !== "collected" ? "Mark collected first" : "Record delivery. Evidence can be added later."}
              onClick={() => void signOff("deliver")}>
              {signingOff === "deliver" ? "Saving…" : "Mark delivered"}
            </button>
          ) : null}
          {failureStop && progress !== "collected" && (
            <div className="w-full">
              <button type="button" aria-expanded={showFailure} disabled={signingOff !== null}
                className="min-h-11 rounded-md border border-line px-2 text-xs font-semibold text-ink"
                onClick={() => setShowFailure(!showFailure)}>
                Unable to collect
              </button>
              {showFailure && (
                <div className="mt-2 grid gap-2">
                  {pendingCollections.length > 1 && (
                    <label className="grid gap-1 text-xs">
                      Collection stop
                      <select className="min-h-11 rounded-md border border-line bg-surface px-2"
                        value={failureStop.id} disabled={signingOff !== null}
                        onChange={(event) => { delete signOffRequests.current.fail; setFailedStopId(event.target.value); }}>
                        {pendingCollections.map((stop) => <option key={stop.id} value={stop.id}>{stop.address_line}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="grid gap-1 text-xs">
                    Reason
                    <select className="min-h-11 rounded-md border border-line bg-surface px-2"
                      value={reason} disabled={signingOff !== null}
                      onChange={(event) => {
                        delete signOffRequests.current.fail;
                        const value = event.target.value;
                        setReason(isCollectionFailureReason(value) ? value : "");
                      }}>
                      <option value="">Choose a reason</option>
                      {Object.entries(COLLECTION_FAILURE_REASONS).map(([value, label]) =>
                        <option key={value} value={value}>{label}</option>
                      )}
                    </select>
                  </label>
                  <button type="button" disabled={!reason || signingOff !== null}
                    className="min-h-11 rounded-md border border-warning px-2 text-xs font-semibold text-ink disabled:opacity-50"
                    onClick={() => { if (reason) void signOff("fail", { stopId: failureStop.id, reason }); }}>
                    {signingOff === "fail" ? "Saving…" : "Save failed collection"}
                  </button>
                </div>
              )}
            </div>
          )}
          {signOffError ? <p role="alert" className="w-full text-xs text-danger">{signOffError}</p> : null}
        </div>
      ) : null}

      {!readOnly && onAppointmentEmail ? <button type="button" draggable={false}
        className="mt-2 min-h-11 rounded-md border border-line px-2 text-xs font-semibold text-ink"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAppointmentEmail(); }}>Send collection / delivery time</button> : null}

      {!readOnly && onCollectionReceipt ? <button type="button" draggable={false}
        className="mt-2 min-h-11 rounded-md border border-line px-2 text-xs font-semibold text-ink"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onCollectionReceipt(); }}>Email collection receipt</button> : null}

      {!readOnly && job.status === "pending_acceptance" ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-warning">
            {sequence !== null
              ? "Assigned · Awaiting acceptance"
              : "Awaiting acceptance"}
          </span>

          {onAccept ? (
            <button
              type="button"
              draggable={false}
              className="min-h-11 rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAccept(job.id);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              Accept
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
