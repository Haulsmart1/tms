import Link from "next/link";
import Container from "../Container";
import { Wordmark } from "./Brand";
import { LEGAL_INDEX_PATH } from "../../lib/legal/routes";
import { VENDOR } from "../../lib/legal/vendor";
import { PUBLIC_CONTACT } from "../../lib/contact/details";

const productLinks = [
  ["/features", "All features"], ["/features/transport-job-management", "Job management"],
  ["/features/electronic-proof-of-delivery", "Proof of delivery"], ["/features/transport-invoicing", "Transport invoicing"],
  ["/#pricing", "Pricing"], ["/guides/choosing-transport-management-software", "Choosing a TMS"],
];
const companyLinks = [["/contact", "Contact"], ["/terms", "Terms"], ["/privacy", "Privacy"], ["/cookies", "Cookies"], ["/accessibility", "Accessibility"], [LEGAL_INDEX_PATH, "All policies"]];

export default function Footer() {
  const registration = [`TMS Wizard is a trading name of ${VENDOR.legalName}, registered in England and Wales`, VENDOR.companyNumber ? `company number ${VENDOR.companyNumber}` : null].filter(Boolean).join(", ");
  return <footer className="brand-footer"><Container>
    <div className="footer-grid"><div><Wordmark /><p className="footer-description">Cloud transport management for the work between booking, delivery and billing.</p><div className="footer-contact"><a href={PUBLIC_CONTACT.phoneHref}>{PUBLIC_CONTACT.phone}</a><a href={`mailto:${PUBLIC_CONTACT.email}`} className="break-all">{PUBLIC_CONTACT.email}</a></div></div>
      <div><h2>THE PRODUCT</h2><nav aria-label="Product footer">{productLinks.map(([href,label]) => <Link href={href} key={href}>{label}</Link>)}</nav></div>
      <div><h2>INFORMATION</h2><nav aria-label="Footer">{companyLinks.map(([href,label]) => <Link href={href} key={href}>{label}</Link>)}<Link href="/login" prefetch={false}>Sign in</Link></nav></div>
    </div>
    <p className="footer-registration">{registration}. Registered office: {VENDOR.addressLines.join(", ")}.<br/>TMS Wizard / Transport management software</p>
  </Container></footer>;
}
