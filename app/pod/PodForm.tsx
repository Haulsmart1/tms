import Field from "../../components/Field";
import Textarea from "../../components/Textarea";
import Button from "../../components/Button";
import PodLink from "../components/PodLink";

export type PodFormValues = {
  recipient_name: string;
  pod_notes: string;
  pod_photo_url: string;
  pod_document_url: string;
};

type Props = {
  stopId: string;
  values: PodFormValues;
  saving: boolean;
  uploadingField: string;
  onChange: (field: keyof PodFormValues, value: string) => void;
  onUpload: (file: File | undefined, field: "pod_photo_url" | "pod_document_url") => void;
  onSave: (markDelivered: boolean) => void;
};

export default function PodForm({
  stopId, values, saving, uploadingField, onChange, onUpload, onSave,
}: Props) {
  /* Button is deliberately NOT disabled while loading (see components/Button
     .tsx: disabling the focused control drops focus to <body>). The page this
     replaced guarded double submission with `disabled={savingStopId ===
     stop.id}`, so the guard has to live somewhere or a second click re-enters
     savePod and can fire the delivered-cascade twice. Button's own contract
     says the consumer guards in the handler, so it guards here. savePod itself
     is unchanged. */
  function save(markDelivered: boolean) {
    if (saving) return;
    onSave(markDelivered);
  }

  return (
    <div className="grid max-w-[620px] gap-2 p-3">
      <Field
        id={`pod-${stopId}-recipient`}
        label="Recipient"
        kickerLabel
        placeholder="Recipient name"
        value={values.recipient_name}
        onChange={(e) => onChange("recipient_name", e.target.value)}
      />

      <Textarea
        id={`pod-${stopId}-notes`}
        label="Notes"
        kickerLabel
        placeholder="POD notes"
        rows={3}
        value={values.pod_notes}
        onChange={(e) => onChange("pod_notes", e.target.value)}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-dashed border-line-strong p-2.5">
          <div className="mb-1.5 text-kicker uppercase text-ink-3">Photo</div>
          <input
            type="file"
            accept="image/*"
            className="text-xs text-ink-2"
            onChange={(e) => onUpload(e.target.files?.[0], "pod_photo_url")}
          />
          {uploadingField === `${stopId}-pod_photo_url` ? (
            <p className="mt-1.5 text-xs text-ink-3">Uploading photo…</p>
          ) : null}
          {values.pod_photo_url ? (
            <div className="mt-2">
              <PodLink value={values.pod_photo_url} label="View uploaded photo" />
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-line p-2.5">
          <div className="mb-1.5 text-kicker uppercase text-ink-3">Document</div>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
            className="text-xs text-ink-2"
            onChange={(e) => onUpload(e.target.files?.[0], "pod_document_url")}
          />
          {uploadingField === `${stopId}-pod_document_url` ? (
            <p className="mt-1.5 text-xs text-ink-3">Uploading document…</p>
          ) : null}
          {values.pod_document_url ? (
            <div className="mt-2">
              <PodLink value={values.pod_document_url} label="View uploaded document" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={saving} onClick={() => save(false)}>
          Save edit
        </Button>
        <Button size="sm" loading={saving} onClick={() => save(true)}>
          Mark delivered
        </Button>
      </div>
    </div>
  );
}
