import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCollectionEmail, type CollectionEmailJob, type CollectionEmailOptions } from "./collectionEmail";
import { loadPodBranding } from "../pod/brandingServer";
import { documentEmailAllowed } from "../documents/emailLimits";
import { sendMicrosoftGraphEmail } from "../documents/delivery";

const JOB_SELECT = "id,tenant_id,reference,status,job_stops(id,tenant_id,type,stop_order,status,collected_at,address_line,city,postcode,contact_name,contact_email,contact_phone),job_items(serial_numbers,description,quantity)";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function loadCollectionEmails(admin: SupabaseClient, tenantId: string, jobIds: string[], options: CollectionEmailOptions) {
  const batches: string[][] = [];
  for (let start = 0; start < jobIds.length; start += 100) batches.push(jobIds.slice(start, start + 100));
  const [queries, branding] = await Promise.all([
    Promise.all(batches.map((ids) => admin.from("jobs").select(JOB_SELECT).eq("tenant_id", tenantId).in("id", ids))),
    loadPodBranding(admin, tenantId),
  ]);
  if (queries.some((query) => query.error)) throw new Error("Unable to load collection contacts.");
  const data = queries.flatMap((query) => query.data ?? []);
  if (data.length !== jobIds.length) throw new Error("One or more jobs are unavailable in this workspace. Refresh the plan.");
  const byId = new Map(data.map((job) => [job.id, job as CollectionEmailJob]));
  return jobIds.map((id) => {
    const job = byId.get(id)!;
    const message = buildCollectionEmail(job, options, branding.carrierName);
    message.preview.fingerprint = digest([message.preview, message.html]);
    // One receipt per stop/contact, regardless of later time corrections;
    // one appointment per date/window/contact. A different window is an update.
    const key = "planning-email:" + digest([tenantId, message.preview.stopId, options.kind, message.preview.email,
      options.kind === "planned_window" ? [options.date, options.window] : "receipt"]);
    return { ...message, key };
  });
}

type Message = Awaited<ReturnType<typeof loadCollectionEmails>>[number];

/** A unique durable claim prevents double clicks/concurrent retries sending
 * duplicates. Ambiguous provider failures remain claimed for manual checking. */
export async function sendCollectionEmail(admin: SupabaseClient, userId: string, message: Message, options: CollectionEmailOptions) {
  const row = message.preview;
  if (row.issue || !row.email || !row.stopId) return { status: "skipped", message: row.issue || "No collection email." };
  const { data: prior, error: priorError } = await admin.from("job_notification_log").select("status")
    .eq("tenant_id", row.tenantId).eq("idempotency_key", message.key).maybeSingle();
  if (priorError) throw new Error("Unable to check email history.");
  if (prior) return duplicateResult(prior.status);
  if (!(await documentEmailAllowed(admin, userId, row.tenantId))) return { status: "skipped", message: "Email limit reached. Try the remaining contacts later." };
  const { data: claim, error: claimError } = await admin.from("job_notification_log").insert({
    tenant_id: row.tenantId, job_id: row.jobId, stop_id: row.stopId,
    channel: "email", notification_type: options.kind, status: "pending", idempotency_key: message.key,
    recipient_name: row.name, recipient_email: row.email, provider: "microsoft_graph", initiated_by: userId,
    metadata: { source: "planning", subject: row.subject, text: row.text, fingerprint: row.fingerprint,
      ...(options.kind === "planned_window" ? { collectionDate: options.date, window: options.window, timeZone: "Europe/London" }
        : { collectionConfirmedBy: userId, collectedAt: options.collectedAt }) },
  }).select("id").single();
  if (claimError?.code === "23505") return duplicateResult("pending");
  if (claimError || !claim) throw new Error("Unable to record email before sending.");
  let accepted = false;
  try {
    const result = await sendMicrosoftGraphEmail({ recipient: row.email, subject: row.subject, text: row.text,
      html: message.html, attachments: [], deliveryLogId: claim.id });
    accepted = true;
    const { error } = await admin.from("job_notification_log").update({ status: "accepted", accepted_at: new Date().toISOString(), provider_message_id: result.acknowledgementId })
      .eq("tenant_id", row.tenantId).eq("id", claim.id);
    if (error) return { status: "accepted", message: "Sent to Microsoft 365; email history update needs checking." };
    return { status: "accepted", message: "Sent to Microsoft 365." };
  } catch (error) {
    if (!accepted) await admin.from("job_notification_log").update({ status: "failed", error_message: "Delivery could not be confirmed. Check Sent Items before retrying." })
      .eq("tenant_id", row.tenantId).eq("id", claim.id);
    console.error("[collection-email] delivery uncertain", claim.id, error instanceof Error ? error.name : "Error");
    return { status: "failed", message: "Delivery could not be confirmed. Check Sent Items before retrying." };
  }
}

function duplicateResult(status: string) {
  return ["accepted", "sent", "delivered"].includes(status)
    ? { status: "already_sent", message: "Already sent; no duplicate email sent." }
    : { status: "skipped", message: "A previous send is pending or uncertain. Check Sent Items before retrying." };
}
