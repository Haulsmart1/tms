"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Modal from "../../components/Modal";
import Skeleton from "../../components/Skeleton";
import { dateTimeIn } from "../../lib/shifts/zonedTime";
import { groupCheckForView, PHASE_LABELS, RESULT_LABELS, SEVERITY_LABELS } from "../../lib/walkaround/checkView";
import { loadCheckDetail, type CheckDetail, type DefectDetail } from "../../lib/walkaround/checksQuery";
import ObjectionDecision from "./ObjectionDecision";
import { resultTone } from "./walkaroundTones";

type Photo = { defectClientId: string; url: string };

function DefectItem({
  defect,
  photos,
  isAdmin,
  timeZone,
  onDecided,
}: {
  defect: DefectDetail;
  photos: Photo[];
  isAdmin: boolean;
  timeZone: string;
  onDecided: () => void;
}) {
  return (
    <li className="grid gap-2 rounded-md border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{defect.label}</span>
        <Badge tone={defect.finalSeverity === "dangerous" ? "danger" : "warning"}>{SEVERITY_LABELS[defect.finalSeverity]}</Badge>
        {defect.escalatedByDriver ? <Badge tone="info">Escalated by driver</Badge> : null}
      </div>
      {defect.note ? <p className="text-sm text-ink-2">Driver&apos;s note: {defect.note}</p> : null}
      <p className="text-sm text-ink-2">
        Maintenance record: {defect.maintenanceStatus ? defect.maintenanceStatus.replace(/_/g, " ") : "none linked"}.{" "}
        {defect.rectifiedAt ? `Rectified ${dateTimeIn(defect.rectifiedAt, timeZone)}.` : "Not rectified yet."}
      </p>
      {photos.length ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block">
              <img src={p.url} alt={`Photo ${i + 1} of ${defect.label}`} className="h-20 w-20 rounded-md border border-line object-cover" />
            </a>
          ))}
        </div>
      ) : defect.photoCount > 0 ? (
        <p className="text-xs text-ink-2">{defect.photoCount} photo(s) recorded but could not be shown.</p>
      ) : null}
      {defect.objections.map((o) => (
        <ObjectionDecision key={o.id} objection={o} isAdmin={isAdmin} timeZone={timeZone} onDecided={onDecided} />
      ))}
    </li>
  );
}

export default function CheckDetailPanel({
  supabase,
  checkId,
  isAdmin,
  timeZone,
  onClose,
  onChanged,
}: {
  supabase: SupabaseClient;
  checkId: string | null;
  isAdmin: boolean;
  timeZone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CheckDetail | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [state, setState] = useState<"loading" | "error" | "missing" | "ready">("loading");
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!checkId) return;
    const mine = ++seq.current;
    setState("loading");
    setDetail(null);
    setPhotos([]);
    try {
      const next = await loadCheckDetail(supabase, checkId);
      if (mine !== seq.current) return;
      setDetail(next);
      setState(next ? "ready" : "missing");
      if (next && next.defects.some((d) => d.photoCount > 0)) {
        const res = await fetch(`/api/walkaround/checks/${encodeURIComponent(checkId)}/photos`);
        const data = (await res.json().catch(() => null)) as { photos?: Photo[] } | null;
        if (mine === seq.current && res.ok) setPhotos(Array.isArray(data?.photos) ? data.photos : []);
      }
    } catch (error) {
      if (mine !== seq.current) return;
      console.error("[maintenance] check detail load failed", error);
      setState("error");
    }
  }, [supabase, checkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = detail ? groupCheckForView(detail.snapshot, detail.defects) : null;
  const photosFor = (d: DefectDetail) => photos.filter((p) => p.defectClientId === d.clientId);
  const decided = () => onChanged();

  return (
    <Modal
      open={checkId !== null}
      onClose={onClose}
      size="lg"
      title={detail ? `${detail.check.registration}: ${PHASE_LABELS[detail.check.phase].toLowerCase()} check` : "Walkaround check"}
      footer={
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {state === "loading" ? (
        <div className="grid gap-2" aria-busy>
          <span className="sr-only" role="status">
            Loading the check
          </span>
          <Skeleton w="60%" h="1rem" />
          <Skeleton w="90%" h="0.75rem" />
          <Skeleton w="80%" h="0.75rem" />
        </div>
      ) : state === "error" ? (
        <p className="text-sm text-danger-strong">
          Couldn&apos;t load this check.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : state === "missing" || !detail || !view ? (
        <p className="text-sm text-ink-2">This check was not found.</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <Badge tone={resultTone(detail.check.result)}>{RESULT_LABELS[detail.check.result]}</Badge>
            <span>
              {detail.check.driverName}, {dateTimeIn(detail.check.performedAt, timeZone)}
              {detail.check.odometer !== null ? `, odometer ${detail.check.odometer}` : ""}
            </span>
          </div>
          {view.groups.length === 0 && view.other.length === 0 ? (
            <p className="text-sm text-ink-2">No checklist items were recorded with this check.</p>
          ) : null}
          <ul className="grid gap-2">
            {view.groups.map((g, i) =>
              g.defects.length === 0 ? (
                <li key={`${g.category}-${i}`} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm">
                  <span className="text-ink">{g.itemLabel}</span>
                  <Badge tone="success">OK</Badge>
                </li>
              ) : (
                <li key={`${g.category}-${i}`} className="grid gap-2 py-1.5">
                  <span className="text-sm font-semibold text-ink">{g.itemLabel}</span>
                  <ul className="grid gap-2">
                    {g.defects.map((d) => (
                      <DefectItem key={d.id} defect={d} photos={photosFor(d)} isAdmin={isAdmin} timeZone={timeZone} onDecided={decided} />
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
          {view.other.length ? (
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-ink">Other defects</span>
              <ul className="grid gap-2">
                {view.other.map((d) => (
                  <DefectItem key={d.id} defect={d} photos={photosFor(d)} isAdmin={isAdmin} timeZone={timeZone} onDecided={decided} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
