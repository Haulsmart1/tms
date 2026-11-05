export function initialStopPodForm(stop: {
  type?: string; recipient_name?: string | null; contact_name?: string | null;
  pod_notes?: string | null; pod_photo_url?: string | null;
}) {
  return {
    recipient_name: stop.recipient_name || (stop.type === "collection" ? stop.contact_name : "") || "",
    pod_notes: stop.pod_notes || "",
    pod_photo_url: stop.pod_photo_url || "",
  };
}
