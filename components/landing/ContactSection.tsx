import Link from "next/link";
import Container from "../Container";
import { SectionHeading } from "./Brand";
import { buttonClasses } from "../Button";
import { PUBLIC_CONTACT } from "../../lib/contact/details";

export default function ContactSection() {
  return (
    <section id="request-access" className="brand-section brand-contact-strip">
      {/* Keep this former anchor as a useful destination for existing bookmarks.
          New links all go to the dedicated Contact page. */}
      <Container className="contact-strip-grid">
        <SectionHeading label="LET&#39;S TALK TRANSPORT" title="Show us how your operation works."><p>Tell us how you manage bookings, delivery evidence and invoicing. We&#39;ll discuss where TMS Wizard fits and what you need to check before rollout.</p></SectionHeading>
        <div className="contact-strip-actions">
          <Link href={PUBLIC_CONTACT.path} className={buttonClasses("primary", "lg")}>Contact the team</Link>
          <a href={PUBLIC_CONTACT.phoneHref} className="text-xl font-semibold text-primary-deep underline">{PUBLIC_CONTACT.phone}</a>
          <a href={`mailto:${PUBLIC_CONTACT.email}`} className="break-all text-base text-primary-deep underline">{PUBLIC_CONTACT.email}</a>
        </div>
      </Container>
    </section>
  );
}
