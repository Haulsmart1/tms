import Container from "../Container";
import { buttonClasses } from "../Button";

export default function PricingCard() {
  return (
    <section id="pricing" className="py-12 md:py-16">
      <Container className="text-center">
        <p className="text-overline uppercase text-ink-2">Pricing</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Simple, per-vehicle pricing</h2>
        <div className="mx-auto mt-6 inline-block rounded-lg border-2 border-primary bg-surface p-6 text-left">
          <div className="text-2xl font-semibold text-ink">
            £10 <span className="text-sm font-normal text-ink-3">per vehicle, per month</span>
          </div>
          <p className="mt-2 text-sm text-ink-2">Every module included · no setup fee</p>
          <a href="#request-access" className={buttonClasses("primary", "lg", "mt-4 w-full")}>
            Request access
          </a>
        </div>
      </Container>
    </section>
  );
}
