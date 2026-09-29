"use client";
/*
  After a pass or minor check. A dangerous result never reaches this screen:
  the page sends the driver to the dashboard, whose blocking panel lists every
  defect, why it is dangerous, and Object / Call / Check a different vehicle.
*/

import Link from "next/link";
import type { WizardPhase } from "../../../lib/walkaround/checkWizard";
import type { CheckResult } from "../../../lib/walkaround/types";
import { w } from "./styles";

export default function ResultStep({
  phase,
  result,
  registration,
  pendingCount,
  photoError,
}: {
  phase: WizardPhase;
  result: CheckResult;
  registration: string;
  pendingCount: number;
  photoError: boolean;
}) {
  return (
    <>
      <p className={w.success}>{phase === "swap" ? `Check submitted. Vehicle swapped to ${registration}.` : "Check submitted. Your shift has started."}</p>
      {result === "minor" ? <p className={w.body}>Your minor defects have been reported to the office. You can drive {registration}.</p> : null}
      {pendingCount > 0 ? (
        <p className={w.warning}>Waiting to sync. It will be sent when you have signal; you can carry on meanwhile.</p>
      ) : (
        <p className={w.muted}>Sent to the office.</p>
      )}
      {photoError ? <p className={w.error}>Some photos could not be saved on this phone. Tell the office.</p> : null}
      <Link className={w.link} href="/driver/dashboard">
        Today&apos;s jobs
      </Link>
    </>
  );
}
