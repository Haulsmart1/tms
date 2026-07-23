import type { Metadata } from "next";
import Script from "next/script";
import LandingNav from "../components/landing/LandingNav";
import Hero from "../components/landing/Hero";
import FeatureGrid from "../components/landing/FeatureGrid";
import PricingCard from "../components/landing/PricingCard";
import RequestAccessForm from "../components/landing/RequestAccessForm";
import Footer from "../components/landing/Footer";

/* A server component. LandingNav and RequestAccessForm are the only client
   components, so the marketing copy ships as static HTML for SEO.

   The `ds` class is load-bearing: Preflight is disabled globally to protect the
   ~15 legacy inline-styled pages, and `ds` opts this subtree into the scoped
   reset in app/globals.css (border-style, box-sizing, control font
   inheritance). Remove it and borders vanish and containers overflow.
   `font-sans` is separate and equally required: without it this renders in
   Inter rather than IBM Plex. See the comment in app/layout.tsx. */
/* The page this replaced was heavily keyword-loaded. The new design is much
   tighter, which is better for humans but drops most of those terms from the
   indexable copy, and the root layout's metadata is only "TMS Wizzard" plus
   "Transport Management System". This page-level metadata carries the head
   terms and the audience terms that would otherwise have been lost. */
export const metadata: Metadata = {
  title: "TMS Wizzard | Cloud Transport Management Software for UK & EU Haulage",
  description:
    "Cloud transport management software for haulage, logistics and delivery operators. Jobs, proof of delivery, invoicing, fleet, drivers, subcontractors and live tracking in one platform. £10 per vehicle per month.",
  keywords: [
    "transport management software",
    "TMS software",
    "haulage software",
    "fleet management software",
    "proof of delivery",
    "transport invoicing",
    "subcontractor management",
    "dispatch software",
    "logistics software UK",
  ],
  openGraph: {
    title: "TMS Wizzard | Cloud Transport Management Software",
    description:
      "Run jobs, proof of delivery, invoicing, fleet, drivers and subcontractors in one cloud platform built for UK and European haulage.",
    type: "website",
    locale: "en_GB",
    siteName: "TMS Wizzard",
  },
};

export default function HomePage() {
  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <Script
        id="tmswizzard-ld-json"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "TMS Wizzard",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Cloud transport management software for jobs, proof of delivery, invoicing, vehicles, drivers, subcontractors, dispatch, and fleet management.",
            offers: {
              // Was price "0", which advertised the product as free and
              // contradicted the pricing card.
              "@type": "Offer",
              price: "10",
              priceCurrency: "GBP",
              description: "Per vehicle, per month",
            },
          }),
        }}
      />
      <LandingNav />
      <main>
        <Hero />
        <FeatureGrid />
        <PricingCard />
        <RequestAccessForm />
      </main>
      <Footer />
    </div>
  );
}
