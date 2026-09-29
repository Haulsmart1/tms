"use client";
/*
  Everything the driver is about to submit, each defect with the severity the
  catalogue gives it (so a DANGEROUS result is no surprise), and the
  declaration. Submitting only queues, so it works with no signal.
*/

import type { QueuedDefect } from "../../../lib/shifts/events";
import type { VehicleConfirmation } from "../../../lib/walkaround/checkWizard";
import { resolveDefect } from "../../../lib/walkaround/severity";
import type { CatalogueItem, CheckResult } from "../../../lib/walkaround/types";
import { w } from "./styles";

type Props = {
  registration: string;
  confirmation: VehicleConfirmation | null;
  odometer: string;
  leaving: { registration: string; odometer: string } | null;
  pullingTrailer: boolean;
  checkedCount: number;
  defects: readonly QueuedDefect[];
  result: CheckResult;
  catalogue: ReadonlyMap<string, CatalogueItem>;
  photoCount: (defectClientId: string) => number;
  declared: boolean;
  onDeclared: (value: boolean) => void;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 text-sm">
      <span className={w.label}>{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  );
}

export default function ReviewStep(props: Props) {
  const { defects, catalogue } = props;
  return (
    <>
      <div>
        <Row label="Vehicle" value={props.registration} />
        <Row label="Confirmed by" value={props.confirmation?.kind === "qr" ? "Cab QR code" : "Typed registration"} />
        {props.leaving ? <Row label={`${props.leaving.registration} left at`} value={props.leaving.odometer} /> : null}
        <Row label="Odometer" value={props.odometer} />
        <Row label="Trailer" value={props.pullingTrailer ? "Yes" : "No"} />
        <Row label="Items checked" value={String(props.checkedCount)} />
      </div>

      <div className="grid gap-2">
        <span className={w.label}>Defects</span>
        {defects.length === 0 ? <p className={w.body}>No defects. Every item marked OK.</p> : null}
        {defects.map((d) => {
          const resolved = resolveDefect(d, catalogue);
          const dangerous = resolved.ok && resolved.value.finalSeverity === "dangerous";
          const photos = props.photoCount(d.clientId);
          return (
            <div key={d.clientId} className="grid gap-1 rounded-xl bg-slate-50 p-3 text-sm">
              <span className={dangerous ? w.dangerBadge : w.minorBadge}>{dangerous ? "DANGEROUS" : "Minor"}</span>
              <span className="font-bold">{resolved.ok ? resolved.value.label : "Defect"}</span>
              {d.note ? <span className="text-slate-700">{d.note}</span> : null}
              {photos > 0 ? <span className={w.muted}>{photos === 1 ? "1 photo" : `${photos} photos`}</span> : null}
            </div>
          );
        })}
      </div>

      {props.result === "dangerous" ? (
        <p className={w.error}>A dangerous defect takes {props.registration} off the road when you submit. Do not drive it.</p>
      ) : null}

      <label className={w.check}>
        <input type="checkbox" className="mt-1 h-5 w-5" checked={props.declared} onChange={(e) => props.onDeclared(e.target.checked)} />
        <span>I declare this check is accurate and complete.</span>
      </label>
    </>
  );
}
