import Badge from "../../components/Badge";
import Card from "../../components/Card";
import { PHASE_LABEL, PHASE_TONE, type RailRow } from "../../lib/tracking/onTheRoad";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   borders here depend on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the borders disappear entirely. */

type Props = {
  rows: RailRow[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  /** Rendered under the list, e.g. "Auto-refresh 30 s · updated 14:02". */
  footNote: string;
};

export default function TrackingRail({ rows, selectedJobId, onSelect, footNote }: Props) {
  return (
    <Card flush>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex-1 text-sm font-semibold text-ink">On the road</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-data-sm tabular-nums text-ink-2">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Nothing on the road right now.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const selected = row.jobId === selectedJobId;
            return (
              <li key={row.jobId}>
                <button
                  type="button"
                  onClick={() => onSelect(row.jobId)}
                  aria-current={selected ? "true" : undefined}
                  /* The selected row is marked by an inset left bar rather than
                     a border, so selection does not shift the row's contents by
                     2px as it moves down the list. */
                  className={`flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
                    selected
                      ? "bg-primary-tint shadow-[inset_2px_0_0_var(--primary)]"
                      : "bg-transparent hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="font-mono text-data tabular-nums text-ink">{row.registration}</span>
                    <span className="flex-1" />
                    <Badge tone={PHASE_TONE[row.phase]}>{PHASE_LABEL[row.phase]}</Badge>
                  </span>

                  <span className="block truncate text-xs text-ink-2">
                    {row.driverName ?? "No driver assigned"}
                  </span>

                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-data-sm text-ink-3">
                      {row.originCity} → {row.destinationCity}
                    </span>
                    <span className="font-mono text-data-sm tabular-nums text-ink-2">
                      {row.scheduledDate ?? "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-4 py-2.5 text-xs text-ink-3">{footNote}</p>
    </Card>
  );
}
