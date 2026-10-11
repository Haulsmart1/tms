import Container from "../Container";
import { SectionHeading } from "./Brand";
import { buttonClasses } from "../Button";
import {
  BILLING_BASIS_SENTENCE,
  THRESHOLD_PARITY_SENTENCE,
  pricingBandRows,
  pricingHeadline,
} from "../../lib/billing/pricingCopy";

/* Every string here is derived from lib/billing/rateCard.ts through
   pricingCopy, so a reprice moves this card rather than leaving it stale.

   Leads with the MINIMUM, not the per-vehicle rate. The floor selects for
   customers who can afford the product, and that selection has to happen here
   rather than after signup. It is framed as "your first N vehicles included"
   because the floor is exactly N vehicles at the headline rate: the same offer,
   stated as what you get rather than as a penalty.

   Bands are WHOLE FLEET, unlike v1's graduated weekly bands. "10% off your
   whole fleet" is accurate here, and the old "vehicles 51+" phrasing would now
   understate the offer. */
export default function PricingCard() {
  const headline = pricingHeadline();
  const bands = pricingBandRows();

  return (
    <section id="pricing" className="brand-section brand-pricing">
      <Container className="pricing-layout">
        <SectionHeading label="PRICING / PER VEHICLE" title="A clear starting point for your fleet."><p>Understand the billing basis before you decide. Pricing is per {headline.periodDays}-day period, excluding VAT, with whole-fleet discounts at the published thresholds.</p><p className="mt-5">Use your active fleet and a representative workflow when discussing the fit with our team.</p></SectionHeading>
        <div className="pricing-panel">
          <div className="price-number">
            {headline.fromLabel}{" "}
            <span className="text-sm font-normal text-ink-2">
              per {headline.periodDays} days
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Includes your first {headline.includedVehicles} vehicles, then{" "}
            {headline.perVehicleLabel} per vehicle · every module included · no
            setup fee
          </p>
          <p className="mt-1 text-sm text-ink-2">{BILLING_BASIS_SENTENCE}</p>

          <table className="mt-4 w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-xs text-ink-2">
              Larger fleets get a discount on every vehicle, not just the ones
              above each threshold
            </caption>
            <tbody>
              {bands.map((band) => (
                <tr key={band.threshold} className="border-t border-line">
                  <td className="py-1.5 pr-6 text-ink-2">{band.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink">
                    {band.discountPercent}%
                    <span className="text-ink-2"> off</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-xs text-ink-2">{THRESHOLD_PARITY_SENTENCE}</p>

          <a
            href="/contact"
            className={buttonClasses("primary", "lg", "mt-5 w-full")}
          >
            Request access
          </a>
        </div>
      </Container>
    </section>
  );
}
