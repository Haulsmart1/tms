import Card from "../../components/Card";
import { waitingLabel } from "../../lib/pod/queue";
import type { AttentionEntry, PodKpis } from "../../lib/pod/kpis";

function money(n: number): string {
  // Thin-space thousands and no decimals: these are indicative totals, and
  // pence add noise to a number nobody reconciles from this screen.
  return `£${Math.round(n).toLocaleString("en-GB").replace(/,/g, " ")}`;
}

type Props = { kpis: PodKpis; attention: AttentionEntry[] };

export default function PodRail({ kpis, attention }: Props) {
  const total = kpis.valueAwaiting || 1; // avoid dividing by zero on an empty queue
  const overduePct = Math.round((kpis.valueOverdue / total) * 100);

  return (
    <div className="grid gap-2.5">
      <Card kicker="Revenue awaiting POD">
        <div className="font-mono text-[30px] font-semibold leading-tight tabular-nums slashed-zero text-ink">
          {money(kpis.valueAwaiting)}
        </div>
        <p className="mb-3 text-xs text-ink-3">Delivered work that cannot be invoiced yet</p>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-danger-strong">Overdue &gt; 48 h</span>
            <span className="font-mono text-data-sm tabular-nums text-danger-strong">
              {money(kpis.valueOverdue)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-danger" style={{ width: `${overduePct}%` }} />
          </div>

          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-warning-strong">Under 48 h</span>
            <span className="font-mono text-data-sm tabular-nums text-warning-strong">
              {money(kpis.valueRecent)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-warning" style={{ width: `${100 - overduePct}%` }} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-kicker uppercase text-ink-3">Needs attention</span>
          <span className="font-mono text-data-sm tabular-nums text-danger-strong">
            {attention.length}
          </span>
        </div>

        {attention.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing overdue right now.</p>
        ) : (
          <ul className="grid list-none gap-2.5 p-0">
            {attention.map((item) => (
              <li key={item.stopId} className="border-l-2 border-danger pl-2.5">
                <div className="text-sm text-ink">
                  <span className="font-mono font-semibold">{item.jobReference}</span>
                  {" · "}
                  {item.destinationCity}
                </div>
                <div className="text-xs text-ink-3">
                  Awaiting POD{" "}
                  <span className="font-mono tabular-nums text-danger-strong">
                    {waitingLabel(item.ageHours)}
                  </span>
                  {" · "}
                  {item.missing}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
