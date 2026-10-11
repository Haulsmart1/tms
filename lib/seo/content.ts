export type FeatureContent = {
  path: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  sections: { heading: string; body: string }[];
  checklist: string[];
  faqs: { question: string; answer: string }[];
};

// Evidence and maturity notes for these claims are in docs/seo/audit.md.
export const FEATURES: FeatureContent[] = [
  {
    path: "/features/transport-job-management",
    title: "Transport job management software | TMS Wizard",
    description: "Manage haulage jobs, collection and delivery stops, vehicle assignments and load manifests in TMS Wizard. Connect the office plan with driver jobs and POD.",
    heading: "Transport job management from booking to delivery",
    intro: "A transport job is more than an address and a date. The office needs collection and delivery details, the driver needs the right stops and load information, and accounts needs a record of what was delivered. TMS Wizard keeps those parts of the job together in one cloud transport management system.",
    sections: [
      { heading: "Keep collection and delivery stops with the job", body: "Create transport jobs with collection and delivery stops rather than passing separate instructions between spreadsheets and messages. Keep customer details and job information in the same workflow so the office can review the booking before assigning the work. Multiple stops stay attached to the job they belong to." },
      { heading: "Assign the work and review the day", body: "Use the planning board to review jobs and assign vehicles and drivers. Open job details from the board to check the stops and items before saving a plan. The saved assignments give the office and drivers a shared starting point; changes to the work still need clear communication, especially once a vehicle is on the road." },
      { heading: "Connect load information with delivery evidence", body: "Build load manifests from jobs and use barcode scanning in the driver workflow for job items. Record proof of delivery against the delivery stop, with recipient details and photo or document evidence. Keeping the evidence attached to the original job helps the office answer delivery questions without searching through unrelated messages." },
      { heading: "Check planning against the work you actually run", body: "A useful plan needs accurate stop details and a practical driver schedule. TMS Wizard provides planning and driver-hours previews, but these do not replace the operator's checks of vehicle suitability, road restrictions or legal obligations. Ask to walk through your own multi-stop work and any specialist requirements before choosing the system." },
    ],
    checklist: ["A job with more than one collection or delivery", "A change to the vehicle or driver assignment", "A load manifest with items to scan", "A completed stop with evidence the office can retrieve"],
    faqs: [
      { question: "Can one transport job contain several stops?", answer: "Yes. Jobs support collection and delivery stops, so the booking and its delivery evidence can remain connected even when the work involves more than one address." },
      { question: "Does the planning software guarantee a compliant route?", answer: "No. Planning previews assist the office, but operators remain responsible for driver-hours, vehicle and road checks. Discuss the requirements of your fleet and routes when requesting access." },
    ],
  },
  {
    path: "/features/electronic-proof-of-delivery",
    title: "Electronic proof of delivery software | TMS Wizard",
    description: "Capture delivery photos, documents, recipient details and notes against transport job stops. Retrieve POD in the office and share revocable customer links.",
    heading: "Electronic proof of delivery linked to the transport job",
    intro: "When a customer asks for delivery evidence, the office needs to find the right record quickly. TMS Wizard connects proof of delivery to the job and delivery stop, bringing recipient details, notes, photos and documents into the transport workflow.",
    sections: [
      { heading: "Record what happened at the delivery stop", body: "Record the recipient and delivery notes alongside the evidence for the stop. The mobile driver job view supports photo capture and item barcode scanning, while the office POD workflow supports photos and delivery documents. Evidence belongs to a specific stop, which matters when a job includes several deliveries." },
      { heading: "Give the office a retrievable delivery record", body: "Office staff can review POD against the job instead of treating each photograph as a separate file to identify later. This makes it easier to match a customer's enquiry to the delivery being discussed. A completion status and its supporting evidence are different parts of the record; confirm both before treating a delivery as ready for billing." },
      { heading: "Share evidence with the intended customer", body: "The POD workflow supports customer share links and a PDF view. Share links can be withdrawn, and delivery files use private storage with time-limited file access. Treat the customer link as sensitive: send it to the intended recipient and withdraw it when it is no longer needed." },
      { heading: "Plan for mobile connectivity", body: "Delivery work often crosses areas with weak signal. Before rollout, test the driver workflow on the phones and routes your fleet uses, including how evidence saves and reaches the office after a connection drops. Opening the driver app without a connection is not a capability to assume; discuss the current offline behaviour and rollout status when requesting access." },
    ],
    checklist: ["Capture a photo and recipient at a delivery stop", "Find the same evidence from the office POD workflow", "Check barcode scanning for your job items", "Open a customer share link, then withdraw it"],
    faqs: [
      { question: "What proof of delivery can TMS Wizard record?", answer: "The workflows support recipient details, notes, photos and delivery documents linked to delivery stops. The mobile driver view also supports barcode scanning of job items." },
      { question: "Are customer POD links public marketing pages?", answer: "No. A share link is intended for a specific customer and is excluded from search indexing. Keep the link private and withdraw it when access is no longer needed." },
    ],
  },
  {
    path: "/features/transport-invoicing",
    title: "Transport invoicing software for haulage | TMS Wizard",
    description: "Connect transport jobs with customer invoicing, payment records, statements and credit notes. Review TMS Wizard's accounts workflow and Xero invoice sync.",
    heading: "Transport invoicing connected to your haulage jobs",
    intro: "The delivery is only one part of finishing a transport job. Accounts needs the customer, the agreed charges and the supporting record before sending an invoice. TMS Wizard brings transport jobs and the commercial workflow into the same platform.",
    sections: [
      { heading: "Review the work before raising the invoice", body: "Use the accounts workflow to review jobs ready to invoice and prepare customer invoices. Check the customer details, charges and delivery evidence together rather than rebuilding the job from a spreadsheet. A delivered status alone does not settle a disputed charge or an agreed customer billing requirement." },
      { heading: "Keep customer accounts in view", body: "Create invoices and credit notes, record payments and prepare customer statements. Chase letters support follow-up on unpaid invoices. Keeping these records together helps the office see what has been billed and what still needs attention; it does not guarantee payment or remove the need to reconcile the customer's account." },
      { heading: "Connect quotations and the transport workflow", body: "The commercial tools also support quotations with online customer acceptance and purchase orders. Review how your team moves from an accepted quotation into the transport job and invoice, particularly where the customer adds stops, changes the load or agrees additional charges." },
      { heading: "Discuss Xero sync for your accounting setup", body: "TMS Wizard includes a Xero connection and invoice-sync workflow. Check the account mapping, tax treatment and handling of an existing invoice with your accounts team before relying on a sync. The transport workflow and your accounting ledger have different jobs; establish which system owns each record during onboarding." },
    ],
    checklist: ["Prepare an invoice from a completed transport job", "Check charges and POD against the customer agreement", "Record a payment and review the customer statement", "Check invoice sync and account mapping if you use Xero"],
    faqs: [
      { question: "Does TMS Wizard support customer statements?", answer: "Yes. The accounts workflow includes statements alongside invoices, payments, credit notes and chase letters." },
      { question: "Can transport invoices be synced to Xero?", answer: "The product includes a Xero connection and invoice-sync workflow. Ask to review the configuration and the specific invoices you need to sync before rollout." },
    ],
  },
];
