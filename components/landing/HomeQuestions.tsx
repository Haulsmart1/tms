import Link from "next/link";
import Container from "../Container";
import { SectionHeading } from "./Brand";
import { pricingHeadline } from "../../lib/billing/pricingCopy";

export default function HomeQuestions() {
  const price = pricingHeadline();
  return (
    <section className="brand-section">
      <Container className="questions-layout">
        <SectionHeading label="BEFORE YOU CHOOSE" title="Start with the work you actually run."><p>Bring a real booking, your delivery-evidence requirements and a customer invoice. A useful demonstration follows the whole job.</p><Link href="/guides/choosing-transport-management-software" className="brand-text-link">Read the TMS selection guide <span aria-hidden="true">&#8599;</span></Link></SectionHeading>
        <div className="questions-items">
          <div className="brand-faq"><h3 className="text-base font-semibold">What does transport management software do?</h3><p className="mt-2 text-base leading-relaxed text-ink-2">A TMS connects transport bookings, the plan for carrying out the work and the records needed after delivery. TMS Wizard brings jobs, driver assignments, POD and customer invoicing into one platform, alongside vehicle, driver and subcontractor records.</p></div>
          <div className="brand-faq"><h3 className="text-base font-semibold">Is it suitable for a smaller haulage fleet?</h3><p className="mt-2 text-base leading-relaxed text-ink-2">Pricing starts at {price.fromLabel} excluding VAT per {price.periodDays} days, including the first {price.includedVehicles} vehicles. Review the pricing and discuss your job volume, delivery evidence and invoicing needs with the team to assess whether the workflow fits.</p></div>
          <div className="brand-faq"><h3 className="text-base font-semibold">Can drivers record proof of delivery?</h3><p className="mt-2 text-base leading-relaxed text-ink-2">The mobile driver workflow supports recipient details, photos and item barcode scanning against delivery stops. <Link href="/features/electronic-proof-of-delivery" className="text-primary-deep underline">Explore electronic proof of delivery</Link> and discuss connectivity requirements before rollout.</p></div>
          <div className="brand-faq"><h3 className="text-base font-semibold">What should I check before choosing a system?</h3><p className="mt-2 text-base leading-relaxed text-ink-2">Walk through a real booking, a multi-stop job, a delivery record and an invoice. Check the driver devices, integrations and exceptions you rely on. Our <Link href="/guides/choosing-transport-management-software" className="text-primary-deep underline">TMS selection guide</Link> gives you a practical checklist.</p></div>
        </div>
      </Container>
    </section>
  );
}
