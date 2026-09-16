import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import Card from "../Card";
import { CARD_SETUP_SENTENCE } from "../../lib/billing/pricingCopy";
import {
  buildGettingStartedSteps,
  isGettingStartedComplete,
  type GettingStartedCounts,
} from "../../lib/dashboard/gettingStarted";

/* Renders correctly ONLY inside a `.ds` wrapper, like Card.

   Shown to a company admin on /dashboard until a card, a vehicle and a driver
   all exist (lib/dashboard/gettingStarted.ts decides). The billing copy is v2
   only: CARD_SETUP_SENTENCE says nothing is charged today and names the
   minimum from the rate card. The v1 sentence ("Your first charge is taken
   today") must never appear here; a self-serve signup is a v2 company. */

type Props = GettingStartedCounts & {
  className?: string;
};

export default function GettingStartedPanel({ cardCount, vehicleCount, driverCount, className }: Props) {
  const counts = { cardCount, vehicleCount, driverCount };
  if (isGettingStartedComplete(counts)) return null;

  const steps = buildGettingStartedSteps(counts, { cardDescription: CARD_SETUP_SENTENCE });
  const remaining = steps.filter((step) => !step.done).length;

  return (
    <Card kicker="Getting started" className={className}>
      <p className="m-0 text-sm text-ink-2">
        {remaining === 1 ? "One step left" : `${remaining} steps left`} to get your operation
        running on TMS Wizzard.
      </p>
      <ol className="m-0 mt-3 grid list-none gap-3 p-0">
        {steps.map((step) => (
          <li
            key={step.key}
            data-step={step.key}
            data-done={step.done ? "true" : "false"}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden
              className={step.done ? "mt-0.5 text-success-strong" : "mt-0.5 text-ink-3"}
            >
              {step.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">
                {step.title}
                {step.done ? <span className="sr-only"> (done)</span> : null}
              </div>
              <p className="m-0 mt-0.5 text-xs text-ink-3">{step.description}</p>
              {step.done ? null : (
                <Link href={step.href} className="mt-1 inline-block text-sm text-primary underline hover:text-primary-hover">
                  {step.linkLabel}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
