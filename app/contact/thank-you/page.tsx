import Container from "../../../components/Container";
import MarketingShell from "../../../components/landing/MarketingShell";
import { PageIntro } from "../../../components/landing/Brand";
import { PUBLIC_CONTACT } from "../../../lib/contact/details";
import { PRIVATE_ROBOTS } from "../../../lib/seo/site";

export const metadata = { title: "Enquiry submitted | TMS Wizard", robots: PRIVATE_ROBOTS };

export default function ThankYouPage() {
  return (
    <MarketingShell>
      <Container className="brand-page-container">
        <PageIntro label="YOUR ENQUIRY" title="Thank you for contacting TMS Wizard"><p>If you’ve completed the form, thank you for your enquiry. You can use the contact details below if you need to follow up.</p></PageIntro>
        <p className="mt-4 text-base text-ink-2">To follow up, call <a href={PUBLIC_CONTACT.phoneHref} className="underline">{PUBLIC_CONTACT.phone}</a> or email <a href={`mailto:${PUBLIC_CONTACT.email}`} className="break-all underline">{PUBLIC_CONTACT.email}</a>.</p>
        <p className="mt-6"><a href={PUBLIC_CONTACT.path} className="text-primary-deep underline">Back to Contact</a></p>
      </Container>
    </MarketingShell>
  );
}
