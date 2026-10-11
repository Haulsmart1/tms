import Link from "next/link";
import Container from "../Container";
import { SectionHeading } from "./Brand";
const steps = [
  { number: "01", team: "THE OFFICE", title: "Start with a complete booking.", body: "Customer details, collection and delivery stops, load items and instructions belong to the same job. Assign a vehicle and driver from the planning workflow.", href: "/features/transport-job-management", link: "Job management & planning", detail: ["Collection & delivery stops", "Vehicle & driver assignments", "Load manifests"] },
  { number: "02", team: "THE DELIVERY", title: "Keep the evidence with the stop.", body: "Record the recipient, notes, photos and documents against the delivery stop. Give the office a record it can retrieve when a customer asks what happened.", href: "/features/electronic-proof-of-delivery", link: "Electronic proof of delivery", detail: ["Recipient details & notes", "Photos & delivery documents", "Withdrawable customer links"] },
  { number: "03", team: "THE ACCOUNTS TEAM", title: "Bring the job into accounts.", body: "Review completed work and charges before preparing customer invoices. Keep payment records, credit notes and statements in the same commercial workflow.", href: "/features/transport-invoicing", link: "Transport invoicing", detail: ["Customer invoices & credit notes", "Payments & statements", "Xero invoice-sync workflow"] },
];
export default function WorkflowStory() {
  return <section className="brand-section" id="workflow"><Container>
    <SectionHeading label="FROM BOOKING TO BILLING" title="The job moves on. The record stays connected."><p>Transport work passes between people. TMS Wizard keeps the booking, assignments, delivery evidence and commercial records in one platform, so each handover has somewhere to start.</p></SectionHeading>
    <div className="workflow-stories">{steps.map(step => <article key={step.number} className="workflow-story"><div className="workflow-number" aria-hidden="true">{step.number}</div><div><p className="brand-eyebrow">{step.team}</p><h3>{step.title}</h3><p>{step.body}</p><Link href={step.href} className="brand-text-link">{step.link} <span aria-hidden="true">↗</span></Link></div><ul>{step.detail.map(item => <li key={item}><span aria-hidden="true">✓</span>{item}</li>)}</ul></article>)}</div>
  </Container></section>;
}
