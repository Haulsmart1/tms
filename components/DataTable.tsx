import { Fragment, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type Column<T> = {
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  className?: string;
  /* Fixed CSS width, emitted as a <colgroup> with table-layout: fixed. Set it
     on every column or none: a mix lets the unspecified ones absorb all the
     leftover width, which opens a large gap in the middle of the row. */
  width?: string;
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
  /** Renders an extra full-width row beneath the matching row. */
  renderExpanded?: (row: T) => ReactNode;
  /** rowKey of the currently expanded row, if any. */
  expandedKey?: string | null;
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
  renderExpanded,
  expandedKey = null,
}: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
      <table
        className={cn(
          "w-full min-w-[640px] border-collapse text-sm",
          columns.some((c) => c.width) && "table-fixed",
        )}
      >
        {columns.some((c) => c.width) ? (
          <colgroup>
            {columns.map((col, i) => (
              <col key={`col-${col.header}-${i}`} style={{ width: col.width }} />
            ))}
          </colgroup>
        ) : null}
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
            ? Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="border-b border-line last:border-0">
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
                <Fragment key={rowKey(row)}>
                  <tr
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
                  {/* The separator lives on the <tr>, matching every other row
                      in this table. On the <td> it would sit on an only-child
                      cell, so `last:border-0` would always match and the border
                      would never render at all. */}
                  {renderExpanded && expandedKey === rowKey(row) ? (
                    <tr className="border-b border-line last:border-0">
                      <td colSpan={columns.length} className="p-0">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
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
