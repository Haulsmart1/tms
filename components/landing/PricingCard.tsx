import Container from "../Container";
import { buttonClasses } from "../Button";
import { PRICE_TIERS, formatPence } from "../../lib/billing/money";

/* Bands are GRADUATED: the rate shown applies to the vehicles in that band
   only, not to the whole fleet. The copy says "vehicles 51+" rather than
   "£5 a vehicle at 50+" on purpose, because a 50-vehicle fleet actually pays
   a blended £7.20. See docs/superpowers/specs/2026-09-04-weekly-tiered-pricing-design.md */
function bandLabel(index: number): string {
  const from = index === 0 ? 1 : (PRICE_TIERS[index - 1].upToVehicle ?? 0) + 1;
  const to = PRICE_TIERS[index].upToVehicle;
  if (to === null) return `Vehicles ${from}+`;
  if (from === 1) return `First ${to} vehicles`;
  return `Vehicles ${from} to ${to}`;
}

export default function PricingCard() {
  return (
    <section id="pricing" className="py-12 md:py-16">
      <Container className="text-center">
        <p className="text-overline uppercase text-ink-2">Pricing</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">
          Simple, per-vehicle pricing
        </h2>
        <div className="mx-auto mt-6 inline-block rounded-lg border-2 border-primary bg-surface p-6 text-left">
          <div className="text-2xl font-semibold text-ink">
            £10{" "}
            <span className="text-sm font-normal text-ink-3">
              per vehicle, per week
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Billed every 4 weeks · every module included · no setup fee
          </p>

          <table className="mt-4 w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-xs text-ink-3">
              Larger fleets pay less on the vehicles above each threshold
            </caption>
            <tbody>
              {PRICE_TIERS.map((tier, index) => (
                <tr key={tier.upToVehicle ?? "rest"} className="border-t border-line">
                  <td className="py-1.5 pr-6 text-ink-2">{bandLabel(index)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink">
                    {formatPence(tier.weeklyPence)}
                    <span className="text-ink-3"> /week</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <a
            href="#request-access"
            className={buttonClasses("primary", "lg", "mt-5 w-full")}
          >
            Request access
          </a>
        </div>
      </Container>
    </section>
  );
}
