import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type Column<T> = {
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  className?: string;
};

export type DataTableState = "loading" | "error" | "empty" | "ready";

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  state: DataTableState;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
  errorMessage?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  state,
  onRowClick,
  skeletonRows = 5,
  errorMessage = "Couldn't load this data.",
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
}: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {columns.map((col, i) => (
              <th
                key={`${col.header}-${i}`}
                className={cn(
                  "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3",
                  col.align === "right" ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state === "loading"
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-line last:border-0">
                  {columns.map((col, i) => (
                    <td key={`${col.header}-${i}`} className="px-4 py-3">
                      <span className="block h-3 w-3/4 animate-pulse rounded bg-surface-2" />
                    </td>
                  ))}
                </tr>
              ))
            : null}

          {state === "ready"
            ? rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-line last:border-0",
                    onRowClick && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2",
                  )}
                >
                  {columns.map((col, i) => (
                    <td
                      key={`${col.header}-${i}`}
                      className={cn(
                        "px-4 py-3 align-middle",
                        col.align === "right" ? "text-right" : "text-left",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            : null}
        </tbody>
      </table>

      {state === "error" ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">{errorMessage}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {state === "empty" ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">{emptyTitle}</p>
          {emptyDescription ? <p className="max-w-sm text-sm text-ink-2">{emptyDescription}</p> : null}
          {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
