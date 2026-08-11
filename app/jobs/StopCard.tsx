import Field from "../../components/Field";
import Button from "../../components/Button";
import PodLink from "../components/PodLink";

export type Stop = {
  id: string;
  stop_order: number;
  type: "collection" | "delivery";
  address_line: string;
  city: string | null;
  postcode: string | null;
  status: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_photo_url: string | null;
};

export type PodFormState = { recipient_name: string; pod_notes: string; pod_photo_url: string };

type Props = {
  stop: Stop;
  podForm: PodFormState | undefined;
  onPodFieldChange: (stopId: string, field: keyof PodFormState, value: string) => void;
  onMarkDelivered: (stopId: string) => void;
};

export default function StopCard({ stop, podForm, onPodFieldChange, onMarkDelivered }: Props) {
  const form: PodFormState = podForm ?? { recipient_name: "", pod_notes: "", pod_photo_url: "" };

  return (
    <div className="rounded-md border border-line bg-surface-2 p-3.5">
      <div className="text-sm">
        <span className="font-semibold text-ink">
          {stop.stop_order}. {stop.type}
        </span>{" "}
        <span className="text-ink-2">
          {stop.address_line}
          {stop.city ? `, ${stop.city}` : ""}
          {stop.postcode ? `, ${stop.postcode}` : ""}
        </span>
      </div>

      <div className="mt-1.5 text-xs text-ink-3">
        Stop status: {stop.status || "-"} · POD: {stop.pod_status || "pending"}
      </div>

      {stop.delivered_at ? (
        <div className="mt-1.5 text-xs text-ink-3">
          Delivered at: {new Date(stop.delivered_at).toLocaleString("en-GB")}
        </div>
      ) : null}

      {stop.recipient_name ? (
        <div className="mt-1.5 text-sm text-ink">Recipient: {stop.recipient_name}</div>
      ) : null}

      {stop.pod_notes ? <div className="mt-1.5 text-sm text-ink">Notes: {stop.pod_notes}</div> : null}

      {stop.pod_photo_url ? (
        <div className="mt-1.5">
          <PodLink value={stop.pod_photo_url} label="View POD" />
        </div>
      ) : null}

      {stop.type === "delivery" && stop.pod_status !== "delivered" ? (
        <div className="mt-3 grid max-w-md gap-3">
          <Field
            id={`recipient-${stop.id}`}
            label="Recipient name"
            value={form.recipient_name}
            onChange={(e) => onPodFieldChange(stop.id, "recipient_name", e.target.value)}
          />
          <Field
            id={`photo-${stop.id}`}
            label="POD photo URL"
            value={form.pod_photo_url}
            onChange={(e) => onPodFieldChange(stop.id, "pod_photo_url", e.target.value)}
          />
          <Field
            id={`notes-${stop.id}`}
            label="POD notes"
            value={form.pod_notes}
            onChange={(e) => onPodFieldChange(stop.id, "pod_notes", e.target.value)}
          />
          <div>
            <Button type="button" onClick={() => onMarkDelivered(stop.id)}>
              Mark Delivered
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
