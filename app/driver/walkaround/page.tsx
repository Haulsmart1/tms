"use client";
/*
  The driver's walkaround check, one step per screen: vehicle, (swap only)
  the odometer of the vehicle being left, odometer, checklist, review, result.
  All input lives here, so Back never loses it. Submitting queues the check
  and its photos (app/driver/driverQueue.ts), so it works with no signal.
  The rules are in lib/walkaround/checkWizard.ts.

  Fixed light palette like /driver/jobs/[jobId]; deliberately not in
  lib/nav/themeableRoutes.ts.
*/

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { SIGN_IN_AGAIN_MESSAGE } from "../../../lib/offline/driverSync";
import { parseOdometer } from "../../../lib/shifts/driverActions";
import {
  answeredCount,
  buildCheckEvent,
  checklistGroups,
  collectDefects,
  localResult,
  needsPreviousEndOdometer,
  phaseFromParam,
  previousEndOdometerError,
  vehicleStepError,
  type CheckAnswers,
  type GroupAnswer,
  type WizardPhase,
} from "../../../lib/walkaround/checkWizard";
import type { CheckResult } from "../../../lib/walkaround/types";
import type { PreparedPhoto } from "../jobs/[jobId]/downscaleImage";
import { useDriverShift } from "../useDriverShift";
import ChecklistStep from "./ChecklistStep";
import OdometerStep from "./OdometerStep";
import ResultStep from "./ResultStep";
import ReviewStep from "./ReviewStep";
import StepFrame, { NextButton, Notice } from "./StepFrame";
import VehicleStep from "./VehicleStep";
import { w } from "./styles";

type Step = "vehicle" | "leaving" | "odometer" | "checklist" | "review" | "result";
type Answers = Omit<CheckAnswers, "phase">;

const EMPTY: Answers = {
  vehicleId: null,
  confirmation: null,
  mismatchReason: "",
  previousEndOdometerText: "",
  odometerText: "",
  pullingTrailer: false,
  answers: {},
  declarationAccepted: false,
};

export default function WalkaroundPage() {
  return (
    <main className={w.main}>
      <div className={w.wrap}>
        <Suspense fallback={<p className={w.body}>Loading the check</p>}>
          <Wizard />
        </Suspense>
      </div>
    </main>
  );
}

function Wizard() {
  const phase: WizardPhase = phaseFromParam(useSearchParams().get("phase"));
  const router = useRouter();
  const shift = useDriverShift();
  const { state } = shift;

  const [step, setStep] = useState<Step>("vehicle");
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [photos, setPhotos] = useState<Record<string, PreparedPhoto[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ result: CheckResult; photoError: boolean } | null>(null);
  // Set once submitting starts: the projected state then shows the new shift,
  // which must not bounce the driver off the result screen.
  const [submitting, setSubmitting] = useState(false);
  const preselected = useRef(false);

  const catalogue = useMemo(() => new Map((state?.catalogue ?? []).map((i) => [i.id, i])), [state?.catalogue]);
  const groups = useMemo(() => checklistGroups(state?.catalogue ?? [], answers.pullingTrailer), [state?.catalogue, answers.pullingTrailer]);

  useEffect(() => {
    if (!state || preselected.current) return;
    preselected.current = true;
    const assigned = state.assignedVehicle?.id ?? null;
    if (assigned) setAnswers((a) => (a.vehicleId ? a : { ...a, vehicleId: assigned }));
  }, [state]);

  // A start check with a shift already open, or a swap with none, is the wrong screen.
  const wrongPhase = Boolean(state && ((phase === "start" && state.openShift) || (phase === "swap" && !state.openShift)));
  useEffect(() => {
    if (wrongPhase && !submitting) router.replace("/driver/dashboard");
  }, [wrongPhase, submitting, router]);

  if (shift.forbidden) return <Notice text="Shift checks are not used for your account." />;
  if (!state) return <Notice text={shift.loading ? "Loading the check" : shift.error ?? "Unable to load the check."} retry={shift.loading ? null : () => void shift.reload()} />;
  if (wrongPhase && !submitting) return <Notice text="Taking you back to your dashboard." />;

  const vehicle = state.vehicles.find((v) => v.id === answers.vehicleId) ?? null;
  const registration = vehicle?.registration ?? "the vehicle";
  const leaving = needsPreviousEndOdometer(phase, state) ? state.openShift?.currentVehicle ?? null : null;
  const kicker = phase === "swap" ? "Swap vehicle" : "Start shift";
  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }));
  const go = (next: Step) => {
    setError("");
    setStep(next);
  };
  const photoCount = (id: string) => photos[id]?.length ?? 0;
  const setAnswer = (key: string, answer: GroupAnswer | null) =>
    setAnswers((a) => {
      const next = { ...a.answers };
      if (answer) next[key] = answer;
      else delete next[key];
      return { ...a, answers: next };
    });

  function next(check: string | null, to: Step) {
    if (check) setError(check);
    else go(to);
  }

  async function submit() {
    if (!state || busy) return;
    const stamp = { clientId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    const built = buildCheckEvent({ ...answers, phase }, state, stamp);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError("");
    setSubmitting(true);
    try {
      await shift.submit(built.event);
    } catch (e) {
      setSubmitting(false);
      setBusy(false);
      setError(e instanceof Error && e.message === SIGN_IN_AGAIN_MESSAGE ? e.message : "This phone could not save the check. Try again.");
      return;
    }
    // The check is queued; photos follow it so they sync after their defects.
    let photoError = false;
    for (const d of built.event.defects) {
      for (const p of photos[d.clientId] ?? []) {
        try {
          await shift.submitPhoto(d.clientId, p.blob, p.mimeType, p.filename);
        } catch {
          photoError = true;
        }
      }
    }
    const result = localResult(built.event.defects, catalogue);
    if (result === "dangerous") {
      router.replace("/driver/dashboard");
      return;
    }
    setBusy(false);
    setDone({ result, photoError });
    setStep("result");
  }

  if (step === "result" && done) {
    return (
      <StepFrame kicker={kicker} title={done.result === "minor" ? "Minor defects reported" : "Check passed"} onBack={null}>
        <ResultStep phase={phase} result={done.result} registration={registration} pendingCount={shift.pendingCount} photoError={done.photoError} />
      </StepFrame>
    );
  }

  if (step === "vehicle") {
    return (
      <>
        <Link className={w.back} href="/driver/dashboard">
          &larr; Dashboard
        </Link>
        <StepFrame
          kicker={kicker}
          title="Which vehicle?"
          onBack={null}
          error={error}
          footer={<NextButton onClick={() => next(vehicleStepError({ ...answers, phase }, state), leaving ? "leaving" : "odometer")} />}
        >
          <VehicleStep
            state={state}
            vehicleId={answers.vehicleId}
            confirmation={answers.confirmation}
            mismatchReason={answers.mismatchReason}
            onVehicle={(vehicleId) => set({ vehicleId })}
            onConfirmation={(confirmation) => set({ confirmation })}
            onMismatchReason={(mismatchReason) => set({ mismatchReason })}
          />
        </StepFrame>
      </>
    );
  }

  if (step === "leaving" && leaving) {
    return (
      <StepFrame
        kicker={kicker}
        title={`Hand back ${leaving.registration}`}
        onBack={() => go("vehicle")}
        error={error}
        footer={<NextButton onClick={() => next(previousEndOdometerError(answers.previousEndOdometerText, state), "odometer")} />}
      >
        <OdometerStep
          label={`Odometer on ${leaving.registration} now`}
          hint={`It read ${leaving.startOdometer} when you took it out.`}
          value={answers.previousEndOdometerText}
          onChange={(previousEndOdometerText) => set({ previousEndOdometerText })}
        />
      </StepFrame>
    );
  }

  if (step === "odometer" || step === "leaving") {
    return (
      <StepFrame
        kicker={kicker}
        title={`Odometer on ${registration}`}
        onBack={() => go(leaving ? "leaving" : "vehicle")}
        error={error}
        footer={<NextButton onClick={() => next(parseOdometer(answers.odometerText) === null ? "Enter the odometer reading as a whole number." : null, "checklist")} />}
      >
        <OdometerStep label="Odometer reading" hint="Whole number, as shown on the dashboard." value={answers.odometerText} onChange={(odometerText) => set({ odometerText })} />
      </StepFrame>
    );
  }

  const checked = answeredCount(groups, answers.answers);
  const defects = collectDefects(groups, answers.answers);

  if (step === "checklist") {
    return (
      <StepFrame
        kicker={kicker}
        title="Walkaround check"
        onBack={() => go("odometer")}
        error={error}
        footer={
          <div className="sticky bottom-0 grid gap-2 bg-slate-100 py-3">
            <p className="m-0 text-center text-sm font-black" aria-live="polite">
              {checked} of {groups.length} checked
            </p>
            <NextButton disabled={groups.length === 0 || checked < groups.length} onClick={() => go("review")} />
          </div>
        }
      >
        {groups.length === 0 ? <p className={w.warning}>The checklist has not loaded. Go back to the dashboard and try again.</p> : null}
        <ChecklistStep
          groups={groups}
          catalogue={catalogue}
          answers={answers.answers}
          pullingTrailer={answers.pullingTrailer}
          photoCount={photoCount}
          onTrailer={(pullingTrailer) => set({ pullingTrailer })}
          onOk={(key) => setAnswer(key, { status: "ok" })}
          onAddDefect={(key, picked) => {
            setPhotos((p) => ({ ...p, [picked.defect.clientId]: picked.photos }));
            setAnswers((a) => {
              const current = a.answers[key];
              const list = current?.status === "defect" ? current.defects : [];
              return { ...a, answers: { ...a.answers, [key]: { status: "defect", defects: [...list, picked.defect] } } };
            });
          }}
          onRemoveDefect={(key, id) => {
            const current = answers.answers[key];
            const list = current?.status === "defect" ? current.defects.filter((d) => d.clientId !== id) : [];
            setAnswer(key, list.length > 0 ? { status: "defect", defects: list } : null);
          }}
        />
      </StepFrame>
    );
  }

  return (
    <StepFrame
      kicker={kicker}
      title="Review and submit"
      onBack={() => go("checklist")}
      error={error}
      footer={
        <button type="button" className={`${w.primary} w-full min-h-14 text-base`} disabled={!answers.declarationAccepted || busy} onClick={() => void submit()}>
          {busy ? "Saving..." : "Submit check"}
        </button>
      }
    >
      <ReviewStep
        registration={registration}
        confirmation={answers.confirmation}
        odometer={answers.odometerText.trim()}
        leaving={leaving ? { registration: leaving.registration, odometer: answers.previousEndOdometerText.trim() } : null}
        pullingTrailer={answers.pullingTrailer}
        checkedCount={checked}
        defects={defects}
        result={localResult(defects, catalogue)}
        catalogue={catalogue}
        photoCount={photoCount}
        declared={answers.declarationAccepted}
        onDeclared={(declarationAccepted) => set({ declarationAccepted })}
      />
    </StepFrame>
  );
}
