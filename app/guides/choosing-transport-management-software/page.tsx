import Link from "next/link";
import Container from "../../../components/Container";
import MarketingShell from "../../../components/landing/MarketingShell";
import { PageIntro } from "../../../components/landing/Brand";
import { jsonLd, publicMetadata, SITE_ORIGIN } from "../../../lib/seo/site";

const path = "/guides/choosing-transport-management-software";
const title = "How to choose transport management software";
export const metadata = publicMetadata(path, `${title} | TMS Wizard`,
  "A practical TMS selection checklist for haulage operators: jobs, planning, driver devices, POD, invoicing, integrations, data access and total cost.");

const sections = [
  { heading: "1. Start with a representative transport job", body: "Choose a job that reflects the work you actually run, including collections, deliveries, items and customer instructions. A single straightforward drop can hide problems that become obvious on a multi-stop job. Ask the supplier to show how the booking is entered, how a change is recorded and how the office finds the job afterwards. If your work has specialist requirements, name them explicitly instead of assuming that a general haulage feature covers them." },
  { heading: "2. Follow the job through planning and assignment", body: "Check how the office assigns a vehicle and driver, reviews unassigned work and changes a plan. Try a late booking or a driver change, then ask what the driver sees. Distinguish a planning board from route optimisation, and a driver-hours preview from a full compliance check. Ask which road restrictions, vehicle constraints and legal checks are supported, which rely on your input and which remain the operator's responsibility." },
  { heading: "3. Test the driver workflow on the devices you use", body: "A desktop demonstration cannot show whether the driver can use the app at a delivery point. Try the actual phone, camera and barcode format your team uses. Check the permission prompts and the steps required to complete a stop. Ask what happens when the connection drops, whether the app must first be opened with signal, how queued saves are shown and how the driver knows when something has failed. Treat offline support as a specific workflow to test, rather than a yes-or-no label." },
  { heading: "4. Retrieve the evidence from the office", body: "Complete a test delivery, then find its recipient details, photos and documents from the office workflow. Check that evidence is attached to the correct stop on a multi-delivery job. If customers need POD, open the customer view and check how access can be withdrawn. Also walk through an exception: an incomplete delivery, a missing photograph or a customer querying the record. The useful test is whether the office can reconstruct what happened without searching several unrelated systems." },
  { heading: "5. Take the completed job into accounts", body: "Use the same example to prepare an invoice. Check customer references, agreed charges and the evidence required by that customer before billing. Ask how credit notes, payments, statements and unpaid invoices are handled. If you use an accounting package, test the exact integration you need, including tax and account mapping, an existing invoice and an error during sync. A named integration is not enough to establish that every part of your accounts process is supported." },
  { heading: "6. Review access, customer links and your data", body: "Check what office staff, drivers and subcontractors can see, and how access changes when someone leaves. Ask how customer share links work and whether they expire or can be withdrawn. Read the supplier's security, privacy and data-processing documents, then clarify how records and delivery evidence can be retrieved when you leave. Demonstrate the available export or retrieval workflow rather than assuming that a downloadable invoice means the whole account is portable." },
  { heading: "7. Compare the full cost and rollout effort", body: "Compare billing periods on the same basis: a 28-day period is different from a calendar month. Check minimum charges, active-vehicle rules, VAT, volume discounts and cancellation terms. Ask whether integrations, training, migration and support carry separate costs. Build a rollout plan around one representative workflow before moving the whole operation, and agree who will resolve incomplete customer, vehicle or job records." },
];

export default function SelectionGuide() {
  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({
        "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: title, item: `${SITE_ORIGIN}${path}` },
        ],
      }) }} />
      <Container className="brand-page-container">
        <article className="brand-guide">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-2"><Link href="/" className="underline">Home</Link><span aria-hidden> / </span><span aria-current="page">TMS selection guide</span></nav>
          <PageIntro label="THE OPERATOR&#39;S GUIDE" title={title}><p>The best starting point for choosing a TMS is your own transport workflow. Follow one representative job through the office, driver and accounts. Use this checklist to ask specific questions and compare systems on the work you need to do.</p></PageIntro>
          <p className="mt-3 text-sm text-ink-2">Written by the TMS Wizard team. This is a product-selection guide; use your own operational and compliance requirements when assessing any system.</p>
          <nav className="guide-index" aria-label="Guide contents"><h2 className="text-base font-semibold">Your selection checklist</h2><ol>{sections.map((section, index) => <li key={section.heading}><a href={`#check-${index + 1}`}>{section.heading}</a></li>)}</ol></nav>
          {sections.map((section, index) => <section id={`check-${index + 1}`} key={section.heading} className="editorial-section"><h2 className="text-xl font-semibold">{section.heading}</h2><p className="mt-3 text-base leading-relaxed text-ink-2">{section.body}</p></section>)}
          <section className="mt-10 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-xl font-semibold">When is a spreadsheet still a practical option?</h2>
            <p className="mt-3 text-base leading-relaxed text-ink-2">A spreadsheet can be practical when job volume is low, one person controls the plan and supporting files are easy to retrieve. It becomes harder to maintain when several people change the plan, drivers send evidence separately and accounts re-enters the same information. Compare the time spent maintaining that process with the cost and rollout work of a TMS. Moving software will not repair inaccurate source records by itself.</p>
          </section>
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Use this checklist to assess TMS Wizard</h2>
            <p className="mt-3 text-base leading-relaxed text-ink-2">Explore our <Link href="/features/transport-job-management" className="text-primary-deep underline">transport job management</Link>, <Link href="/features/electronic-proof-of-delivery" className="text-primary-deep underline">electronic POD</Link> and <Link href="/features/transport-invoicing" className="text-primary-deep underline">transport invoicing</Link> workflows. Review <a href="/#pricing" className="text-primary-deep underline">pricing</a> and <Link href="/legal" className="text-primary-deep underline">the published policies</Link>, then <a href="/contact" className="text-primary-deep underline">request access</a> with an example of the work you need to manage.</p>
          </section>
        </article>
      </Container>
    </MarketingShell>
  );
}
