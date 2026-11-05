import { normalizeEmail } from "../pod/emailRecipients";
import { buildDocumentEmailHtml } from "../documents/emailTemplate";

export type CollectionEmailKind = "planned_window" | "collection_receipt";
export type CollectionEmailOptions = {
  kind: CollectionEmailKind;
  date: string;
  window: "AM" | "PM";
  collectedAt: string;
};
export type CollectionEmailPreview = {
  jobId: string;
  tenantId: string;
  reference: string;
  name: string;
  email: string | null;
  address: string;
  stopId: string | null;
  subject: string;
  text: string;
  fingerprint: string;
  issue: string | null;
};
export type CollectionEmailJob = {
  id: string; tenant_id: string; reference: string | null; status: string | null;
  job_stops: Array<{
    id: string; tenant_id: string; type: string | null; stop_order: number;
    status: string | null; collected_at: string | null;
    address_line: string; city: string | null; postcode: string | null;
    contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  }>;
  job_items: Array<{ serial_numbers: string[] | null; description: string | null; quantity: number }>;
};

export function isOpenPlanningJob(job: { status?: string | null }): boolean {
  return !["completed", "cancelled", "canceled"].includes((job.status ?? "").toLowerCase());
}

export function collectionEmailOptionsError(options: CollectionEmailOptions, now = new Date()): string | null {
  if (options.kind === "collection_receipt") {
    const time = new Date(options.collectedAt).getTime();
    return !Number.isFinite(time) || time > now.getTime() || time < Date.UTC(2000, 0, 1)
      ? "Enter the actual collection date and time, which must be in the past." : null;
  }
  if (options.kind !== "planned_window" || !["AM", "PM"].includes(options.window)) return "Choose AM or PM.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) return "Choose a valid collection date.";
  const date = new Date(`${options.date}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== options.date) return "Choose a valid collection date.";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return options.date < today ? "The collection date cannot be in the past." : null;
}

/** Only the collection stop's own contact is used. The account/customer may
 * be the manufacturer and must never receive the householder's appointment. */
export function buildCollectionEmail(job: CollectionEmailJob, options: CollectionEmailOptions, carrierName: string) {
  const stops = job.job_stops.filter((s) => s.tenant_id === job.tenant_id && s.type === "collection");
  const stop = stops.length === 1 ? stops[0] : null;
  const reference = job.reference || job.id;
  const email = normalizeEmail(stop?.contact_email);
  const address = stop ? [stop.address_line, stop.city, stop.postcode].filter(Boolean).join(", ") : "";
  let issue: string | null = null;
  if (!stop) issue = "A single collection stop is required. Open the job to check its stops.";
  else if (!email) issue = "Missing or invalid collection email. Add it to the collection contact on the job.";
  else if (["cancelled", "canceled"].includes(job.status ?? "")) issue = "This job is cancelled.";
  else if (options.kind === "planned_window" && (!isOpenPlanningJob(job) || stop.collected_at || ["collected", "completed"].includes(stop.status ?? ""))) {
    issue = "Already recorded as collected; no collection appointment will be sent.";
  }
  const receipt = options.kind === "collection_receipt";
  const title = receipt ? "Collection receipt" : "Your collection appointment";
  const when = receipt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(options.collectedAt)) + " (UK time)"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" }).format(new Date(`${options.date}T12:00:00Z`)) + ` — ${options.window} (${options.window === "AM" ? "09:00–12:00" : "12:00–17:00"}, UK time)`;
  const intro = receipt
    ? `${carrierName} confirms that your goods have been collected from the address below.`
    : `${carrierName} plans to collect your goods during the window below. Please have the goods ready for collection.`;
  const rows = [
    { label: "Job reference", value: reference },
    { label: receipt ? "Collected at" : "Collection window", value: when },
    { label: "Collection address", value: address },
    { label: "Contact", value: [stop?.contact_name, stop?.contact_phone].filter(Boolean).join(" · ") },
    { label: "Items", value: job.job_items.map((i) => `${i.quantity} × ${i.description || "item"}`).join("; ") },
    { label: "Barcode / serial", value: job.job_items.flatMap((i) => i.serial_numbers ?? []).join("; ") },
  ].filter((r) => r.value);
  const text = [`Hi ${stop?.contact_name || "there"},`, "", intro, "", ...rows.map((r) => `${r.label}: ${r.value}`), "", "Regards,", carrierName].join("\n");
  return {
    preview: { jobId: job.id, tenantId: job.tenant_id, reference, name: stop?.contact_name || "", email, address, stopId: stop?.id ?? null, subject: `${title} — ${reference}`.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180), text, fingerprint: "", issue } satisfies CollectionEmailPreview,
    html: buildDocumentEmailHtml({ companyName: carrierName, recipientName: stop?.contact_name, title, intro, summaryRows: rows }),
  };
}
