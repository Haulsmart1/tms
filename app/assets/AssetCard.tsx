import Badge, { type Tone } from "../../components/Badge";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Asset } from "./types";

type Props = {
  asset: Asset;
  loading?: boolean;
  onEdit: (asset: Asset) => void;
};

/* ONE layout definition for both states, the same contract as CustomerCard:
   a separate AssetsSkeleton mirroring these class names would drift the first
   time anyone edits the real card, and nothing under lib/ would catch it.

   Only data-bearing leaves become skeletons. The detail labels, the notes
   frame and the Edit button carry no data, so they render for real. */
export default function AssetCard({ asset, loading = false, onEdit }: Props) {
  return (
    <article
      aria-busy={loading}
      className="grid content-start gap-4 rounded-lg border border-line bg-surface-2 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="11ch" h="1rem" /> : asset.name}
          </h3>

          <div className="mt-1 break-words text-sm font-semibold text-primary-deep">
            {loading ? (
              <Skeleton display="inline-block" w="7ch" h="0.875rem" />
            ) : (
              asset.asset_number || "No asset number"
            )}
          </div>
        </div>

        {loading ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : (
          <Badge tone={statusTone(asset.status)}>
            {formatLabel(asset.status || "active")}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AssetDetail label="Type" loading={loading} value={asset.asset_type} />
        <AssetDetail
          label="Identifier"
          loading={loading}
          value={formatLabel(asset.identifier_type || "internal")}
        />
        <AssetDetail
          label="Mechanical"
          loading={loading}
          value={asset.mechanical ? "Yes" : "No"}
        />
        <AssetDetail label="Serial" loading={loading} value={asset.serial_number || "—"} />
        <AssetDetail label="Barcode" loading={loading} value={asset.barcode || "—"} />
        <AssetDetail
          label="Registration"
          loading={loading}
          value={asset.registration || "—"}
        />
      </div>

      {/* Notes and the maintenance pill are both conditional on data that has
          not arrived yet, so the loading pass renders neither rather than
          guessing. This card grows a little when real notes land. */}
      {!loading && asset.notes ? (
        <div className="break-words rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-ink-2">
          {asset.notes}
        </div>
      ) : null}

      {!loading && asset.mechanical ? (
        <div>
          <Badge tone="info">Maintenance enabled</Badge>
        </div>
      ) : null}

      <Button variant="secondary" size="sm" disabled={loading} onClick={() => onEdit(asset)}>
        Edit Asset
      </Button>
    </article>
  );
}

function AssetDetail({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-kicker uppercase text-ink-3">{label}</span>

      <strong className="block break-words text-sm font-semibold text-ink-2">
        {loading ? <Skeleton display="inline-block" w="6ch" h="0.75rem" /> : value}
      </strong>
    </div>
  );
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusTone(status: string | null): Tone {
  if (status === "inactive") {
    return "danger";
  }

  if (status === "maintenance") {
    return "warning";
  }

  return "success";
}
