import Hero from "../components/landing/Hero";
import FeatureGrid from "../components/landing/FeatureGrid";
import PricingCard from "../components/landing/PricingCard";
import ContactSection from "../components/landing/ContactSection";
import MarketingShell from "../components/landing/MarketingShell";
import HomeQuestions from "../components/landing/HomeQuestions";
import WorkflowStory from "../components/landing/WorkflowStory";
import OperationalConfidence from "../components/landing/OperationalConfidence";
import { pricingHeadline } from "../lib/billing/pricingCopy";
import { jsonLd, publicMetadata, SITE_NAME, SITE_ORIGIN } from "../lib/seo/site";

const pricing = pricingHeadline();
export const metadata = publicMetadata("/", "TMS Wizard | Transport management software for UK haulage",
  "Cloud transport management software for haulage operators. Connect jobs, proof of delivery, invoicing, vehicles, drivers and subcontractors in one platform.");

export default function HomePage() {
  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: SITE_NAME, url: `${SITE_ORIGIN}/`, inLanguage: "en-GB" },
          {
            "@type": "SoftwareApplication", "@id": `${SITE_ORIGIN}/#software`, name: SITE_NAME,
            url: `${SITE_ORIGIN}/`, applicationCategory: "BusinessApplication", operatingSystem: "Web",
            description: "Cloud transport management software for jobs, proof of delivery, invoicing, vehicles, drivers and subcontractors.",
            offers: {
              "@type": "Offer", url: `${SITE_ORIGIN}/#pricing`,
              price: (pricing.fromPence / 100).toFixed(2), priceCurrency: "GBP",
              description: `Per ${pricing.periodDays}-day period, including the first ${pricing.includedVehicles} vehicles, billed in arrears. Excludes VAT.`,
            },
          },
        ],
      }) }} />
      <Hero />
      <WorkflowStory />
      <FeatureGrid />
      <OperationalConfidence />
      <PricingCard />
      <HomeQuestions />
      <ContactSection />
    </MarketingShell>
  );
}
