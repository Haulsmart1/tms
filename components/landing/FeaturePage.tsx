import Link from "next/link";
import Container from "../Container";
import { buttonClasses } from "../Button";
import MarketingShell from "./MarketingShell";
import { PageIntro } from "./Brand";
import ContactSection from "./ContactSection";
import { FEATURES, type FeatureContent } from "../../lib/seo/content";
import { jsonLd, SITE_ORIGIN } from "../../lib/seo/site";

export default function FeaturePage({ content }: { content: FeatureContent }) {
  return <MarketingShell>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Features", item: `${SITE_ORIGIN}/features` },
        { "@type": "ListItem", position: 3, name: content.heading, item: `${SITE_ORIGIN}${content.path}` },
      ],
    }) }} />
    <Container className="brand-page-container">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-sm text-ink-2"><Link href="/" className="underline">Home</Link><span aria-hidden>/</span><Link href="/features" className="underline">Features</Link><span aria-hidden>/</span><span aria-current="page">{content.heading}</span></nav>
      <PageIntro label="TMS WIZARD / PRODUCT WORKFLOW" title={content.heading}><p>{content.intro}</p></PageIntro>
      <div className="brand-actions mb-10"><Link href="/contact" className={buttonClasses("primary", "lg")}>Discuss your transport workflow <span aria-hidden="true">↗</span></Link><a href="/#pricing" className="brand-text-link">Review pricing <span aria-hidden="true">→</span></a></div>
      <div className="feature-editorial"><article>
        {content.sections.map((section) => <section key={section.heading} className="editorial-section"><h2>{section.heading}</h2><p>{section.body}</p></section>)}
        <section className="editorial-section"><h2>Common questions</h2><div className="mt-6">{content.faqs.map(faq => <div className="brand-faq" key={faq.question}><h3>{faq.question}</h3><p>{faq.answer}</p></div>)}</div></section>
      </article><aside>
        <section className="brand-checklist"><p className="brand-eyebrow">CHECK THE FIT</p><h2 className="mt-3">Bring your own job.</h2><p>Walk through these steps with the team when you request access:</p><ul>{content.checklist.map(item => <li key={item}>{item}</li>)}</ul><Link href="/contact" className="brand-text-link mt-4">Talk to the team <span aria-hidden="true">↗</span></Link></section>
        <nav aria-label="Related transport software pages" className="mt-8"><h2 className="text-base font-semibold">Follow the connected workflow</h2><ul className="mt-3 list-none space-y-3 pl-0">{FEATURES.filter(feature => feature.path !== content.path).map(feature => <li key={feature.path}><Link href={feature.path} className="text-primary-deep underline">{feature.heading}</Link></li>)}<li><Link href="/guides/choosing-transport-management-software" className="text-primary-deep underline">How to choose transport management software</Link></li></ul></nav>
      </aside></div>
    </Container><ContactSection />
  </MarketingShell>;
}
