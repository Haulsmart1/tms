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
