/* The getting-started panel on /dashboard for a founding admin (decision 2 in
   docs/superpowers/specs/2026-09-16-self-serve-signup-design.md).

   Pure: counts in, steps out. The component in
   components/dashboard/GettingStartedPanel.tsx renders whatever this says and
   the page supplies the counts. */

export type GettingStartedCounts = {
  /** company_billing rows for the company: 0 or 1. */
  cardCount: number;
  vehicleCount: number;
  driverCount: number;
};

export type GettingStartedStep = {
  key: "card" | "vehicle" | "driver";
  title: string;
  description: string;
  href: string;
  linkLabel: string;
  done: boolean;
};

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function buildGettingStartedSteps(
  counts: GettingStartedCounts,
  copy: { cardDescription: string },
): GettingStartedStep[] {
  return [
    {
      key: "card",
      title: "Add a card",
      description: copy.cardDescription,
      href: "/settings/billing",
      linkLabel: "Go to billing",
      done: positive(counts.cardCount),
    },
    {
      key: "vehicle",
      title: "Add your first vehicle",
      description: "Vehicles are the fleet you plan, track and bill for. Add one to start booking jobs.",
      href: "/vehicles",
      linkLabel: "Go to vehicles",
      done: positive(counts.vehicleCount),
    },
    {
      key: "driver",
      title: "Add your first driver",
      description: "Drivers are assigned to jobs and can use the driver app for proof of delivery.",
      href: "/drivers",
      linkLabel: "Go to drivers",
      done: positive(counts.driverCount),
    },
  ];
}

/* The hide rule: every step satisfied. A count that failed to load reads as
   zero at the call site, so the panel errs toward showing. */
export function isGettingStartedComplete(counts: GettingStartedCounts): boolean {
  return positive(counts.cardCount) && positive(counts.vehicleCount) && positive(counts.driverCount);
}
