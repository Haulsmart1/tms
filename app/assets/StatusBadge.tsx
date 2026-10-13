import Badge, { type Tone } from "../../components/Badge";
import { assetStatus, isArchived } from "../../lib/assets/register";
import { formatLabel, type Asset } from "../../lib/assets/types";

function statusTone(status: string): Tone {
  if (status === "inactive") return "danger";
  if (status === "maintenance") return "warning";
  return "success";
}

export default function StatusBadge({ asset }: { asset: Asset }) {
  const status = assetStatus(asset);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={statusTone(status)}>{formatLabel(status)}</Badge>
      {isArchived(asset) ? <Badge tone="neutral">Archived</Badge> : null}
    </span>
  );
}
