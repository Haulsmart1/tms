import Container from "../../components/Container";
import MarketingShell from "../../components/landing/MarketingShell";
import { PageIntro } from "../../components/landing/Brand";
import EnquiryForm from "../../components/contact/EnquiryForm";
import { PUBLIC_CONTACT } from "../../lib/contact/details";
import { jsonLd, publicMetadata, SITE_NAME, SITE_ORIGIN } from "../../lib/seo/site";

export const metadata = publicMetadata(PUBLIC_CONTACT.path, "Contact TMS Wizard | Transport software enquiries",
  `Discuss transport jobs, POD and invoicing with TMS Wizard. Call ${PUBLIC_CONTACT.phone}, email ${PUBLIC_CONTACT.email} or send a software enquiry.`);

export default function ContactPage() {
  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({
        "@context": "https://schema.org", "@type": "ContactPage", name: "Contact TMS Wizard", url: `${SITE_ORIGIN}${PUBLIC_CONTACT.path}`,
        mainEntity: { "@type": "Organization", name: SITE_NAME, url: `${SITE_ORIGIN}/`, email: PUBLIC_CONTACT.email, telephone: PUBLIC_CONTACT.phone },
      }) }} />
      <Container className="brand-page-container">
        <PageIntro label="LET&#39;S TALK TRANSPORT" title="Contact TMS Wizard"><p>Every operation has its own handovers, exceptions and customer requirements. Tell us how you work, ask for access or get help with TMS Wizard.</p></PageIntro>
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <section aria-labelledby="contact-details-heading" className="brand-contact-details min-w-0 rounded-lg border border-line p-5 sm:p-6">
            <h2 id="contact-details-heading" className="text-xl font-semibold">Speak to the team</h2>
            <p className="mt-5 text-sm text-ink-2">Telephone</p>
            <a href={PUBLIC_CONTACT.phoneHref} className="mt-1 inline-block text-2xl font-semibold text-primary-deep underline">{PUBLIC_CONTACT.phone}</a>
            <p className="mt-5 text-sm text-ink-2">Email</p>
            <a href={`mailto:${PUBLIC_CONTACT.email}`} className="mt-1 inline-block break-all text-base font-semibold text-primary-deep underline">{PUBLIC_CONTACT.email}</a>
            <h3 className="mt-8 text-base font-semibold">Already using TMS Wizard?</h3>
            <p className="mt-2 text-base leading-relaxed text-ink-2">Choose “Existing customer support” in the form and describe what you need help with. Use a job reference where useful, without including customer records or login details.</p>
          </section>
          <EnquiryForm />
        </div>
      </Container>
    </MarketingShell>
  );
}
