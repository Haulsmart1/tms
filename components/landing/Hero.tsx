import Link from "next/link";
import Container from "../Container";
import { buttonClasses } from "../Button";
import { PUBLIC_CONTACT } from "../../lib/contact/details";
import ProductBoard from "./ProductBoard";

export default function Hero() {
  return <section className="brand-hero">
    <Container className="hero-grid">
      <div className="hero-copy">
        <p className="brand-eyebrow">CLOUD TMS / BUILT FOR UK HAULAGE</p>
        <h1>Every job.<br/>Every handover.<br/><span>One connected operation.</span></h1>
        <p className="hero-description">Transport management software that connects your office, drivers and accounts. From the first booking to proof of delivery and the customer invoice, keep the work with the job.</p>
        <div className="brand-actions"><Link href="/contact" className={buttonClasses("primary", "lg")}>Discuss your operation <span aria-hidden="true">↗</span></Link><Link href="/features" className="brand-text-link">Explore the workflows <span aria-hidden="true">→</span></Link></div>
        <p className="hero-phone">Speak to the team: <a href={PUBLIC_CONTACT.phoneHref}>{PUBLIC_CONTACT.phone}</a></p>
      </div>
      <ProductBoard />
    </Container>
    <Container><div className="hero-bottom"><span>BOOK THE WORK</span><span aria-hidden="true">→</span><span>ASSIGN THE JOB</span><span aria-hidden="true">→</span><span>RECORD THE DELIVERY</span><span aria-hidden="true">→</span><span>PREPARE THE INVOICE</span></div></Container>
  </section>;
}
