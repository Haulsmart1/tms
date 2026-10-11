import Link from "next/link";
import Container from "../Container";
import { SectionHeading } from "./Brand";
export default function OperationalConfidence() {
  return <section className="brand-section brand-confidence"><Container className="confidence-grid">
    <SectionHeading label="RECORDS YOU CAN WORK FROM" title="Clear records. Considered access."><p>A transport system should help you understand the work and handle its evidence carefully. Ask us to walk through these controls with your own workflow.</p><Link href="/security" className="brand-text-link">Read the security policy <span aria-hidden="true">↗</span></Link></SectionHeading>
    <div className="confidence-items"><article><span className="brand-eyebrow">01 / DELIVERY EVIDENCE</span><h3>Share deliberately.</h3><p>Customer POD links can be withdrawn. Delivery files use private storage with time-limited file access. Treat share links as sensitive.</p></article><article><span className="brand-eyebrow">02 / OPERATIONAL RECORDS</span><h3>Keep the context.</h3><p>Vehicle, maintenance and driver records sit alongside the transport workflow. Planning previews support your checks; the operator remains responsible for compliance.</p></article><article><span className="brand-eyebrow">03 / CLEAR TERMS</span><h3>Read before you commit.</h3><p>Review the published <Link href="/privacy">privacy notice</Link>, <Link href="/dpa">data-processing terms</Link> and <Link href="/accessibility">accessibility statement</Link>. Discuss any requirements specific to your operation.</p></article></div>
  </Container></section>;
}
