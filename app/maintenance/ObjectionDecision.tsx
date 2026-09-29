"use client";

/*
  A driver's objection to a walkaround VOR, and the admin's decision on it.
  Approving does not return the vehicle to service: the admin still does that
  from the Records tab, where the WLK01 guard now lets it through. The route
  re-checks that the caller is an admin and that the notice was accepted.
*/

import { useState } from "react";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";
import Textarea from "../../components/Textarea";
import { dateTimeIn } from "../../lib/shifts/zonedTime";
import type { DefectObjection } from "../../lib/walkaround/checksQuery";
import { LIABILITY_NOTICE_TEXT, LIABILITY_NOTICE_VERSION } from "../../lib/walkaround/liability";

export type ObjectionView = DefectObjection;

const APPROVED_MESSAGE = "Approved. Return the vehicle to service from the Records tab when you are ready.";

export default function ObjectionDecision({
  objection,
  isAdmin,
  timeZone,
  onDecided,
}: {
  objection: ObjectionView;
  isAdmin: boolean;
  timeZone: string;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [approving, setApproving] = useState(false);
  const [saving, setSaving] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<"approved" | "rejected" | null>(null);

  async function decide(decision: "approve" | "reject") {
    if (saving) return;
    if (decision === "approve" && !accepted) {
      setError("Tick the box to accept the notice before approving.");
      return;
    }
    setSaving(decision);
    setError("");
    try {
      const res = await fetch(`/api/walkaround/objections/${encodeURIComponent(objection.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: note.trim() || undefined,
          liabilityAccepted: decision === "approve" ? accepted : false,
          liabilityVersion: decision === "approve" ? LIABILITY_NOTICE_VERSION : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof data?.error === "string" ? data.error : "Unable to save the decision.");
        return;
      }
      setResult(decision === "approve" ? "approved" : "rejected");
      onDecided();
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  const status = result ?? objection.status;

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {objection.driverName} objected on {dateTimeIn(objection.raisedAt, timeZone)}
        </span>
        <Badge tone={status === "approved" ? "success" : status === "rejected" ? "neutral" : "warning"}>
          {status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Awaiting a decision"}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-ink-2">&ldquo;{objection.reason}&rdquo;</p>

      {status !== "pending" ? (
        <p className="mt-2 text-sm text-ink-2">
          {result === "approved" ? APPROVED_MESSAGE : null}
          {!result && objection.decidedAt ? `Decided ${dateTimeIn(objection.decidedAt, timeZone)}.` : null}
          {!result && objection.decisionNote ? ` Note: ${objection.decisionNote}` : null}
          {result === "rejected" ? "Rejected. The vehicle stays off the road until the defect is rectified." : null}
        </p>
      ) : !isAdmin ? (
        <p className="mt-2 text-sm text-ink-2">Only an admin can decide an objection.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          <Textarea
            id={`objection-note-${objection.id}`}
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          {approving ? (
            <div className="grid gap-2 rounded-md border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
              <p>{LIABILITY_NOTICE_TEXT}</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
                <span>I accept this on behalf of the operator</span>
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {approving ? (
              <>
                <Button size="sm" onClick={() => void decide("approve")} disabled={!accepted} loading={saving === "approve"}>
                  Approve objection
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setApproving(false)}>
                  Back
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => setApproving(true)}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void decide("reject")} loading={saving === "reject"}>
                  Reject
                </Button>
              </>
            )}
          </div>
          <MessageBanner tone="danger">{error || null}</MessageBanner>
        </div>
      )}
    </div>
  );
}
