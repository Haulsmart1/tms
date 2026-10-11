import Link from "next/link";
import Container from "../../components/Container";
import MarketingShell from "../../components/landing/MarketingShell";
import { PageIntro } from "../../components/landing/Brand";
import ContactSection from "../../components/landing/ContactSection";
import { FEATURES } from "../../lib/seo/content";
import { publicMetadata } from "../../lib/seo/site";

export const metadata = publicMetadata("/features", "Transport management software features | TMS Wizard",
  "Explore TMS Wizard's connected transport workflows: haulage job management, electronic proof of delivery and customer invoicing. Find the right fit for your operation.");

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <Container className="brand-page-container">
        <PageIntro label="THE CONNECTED WORKFLOW" title="Transport management software for the whole job"><p>A haulage job moves between the office, the driver and accounts. TMS Wizard connects the booking, delivery evidence and customer invoice so each team can work from the same job record.</p></PageIntro>
        <div className="brand-page-cards">
          {FEATURES.map((feature, index) => (
            <section key={feature.path} className="brand-page-card">
              <p className="brand-eyebrow">0{index + 1} / WORKFLOW</p>
              <h2 className="text-xl font-semibold"><Link href={feature.path} className="text-primary-deep underline">{feature.heading}</Link></h2>
              <p className="mt-3 text-base leading-relaxed text-ink-2">{feature.intro}</p>
            </section>
          ))}
        </div>
        <section className="editorial-section mt-10 max-w-3xl">
          <h2 className="text-xl font-semibold">Fleet, drivers and subcontractors around the job</h2>
          <p className="mt-3 text-base leading-relaxed text-ink-2">The platform also includes vehicle and driver records, assets, maintenance and vehicle-off-road status, subcontractor records and assigned-job portals. Tracking views show the latest available vehicle positions. Check which feeds and workflows are configured for your fleet before relying on them in daily operations.</p>
          <p className="mt-3 text-base leading-relaxed text-ink-2">A feature list is a starting point. Bring a representative transport job, the evidence your customers require and an invoice example when you <a href="/contact" className="text-primary-deep underline">request access</a>. That gives you a concrete way to assess the fit.</p>
          <p className="mt-4"><Link href="/guides/choosing-transport-management-software" className="text-primary-deep underline">Read the transport management software selection guide</Link></p>
          <p className="mt-4"><a href="/#pricing" className="text-primary-deep underline">Review per-vehicle pricing</a></p>
        </section>
      </Container>
      <ContactSection />
    </MarketingShell>
  );
}
