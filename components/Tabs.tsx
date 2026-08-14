import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Card and Button. */

export type Tab = { id: string; label: string; count?: number };

type Props = {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list, e.g. "Proof of delivery views". */
  label: string;
};

export default function Tabs({ tabs, activeId, onChange, label }: Props) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1.5">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "border-primary-tint-border bg-primary-tint text-primary-deep"
                : "border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="font-mono text-data-sm tabular-nums">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
