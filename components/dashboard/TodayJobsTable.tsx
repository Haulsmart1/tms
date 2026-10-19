import Link from "next/link";
import DataTable, { type Column, type DataTableState } from "../DataTable";

export type TodayJobRow = {
  id: string;
  reference: string;
  customerName: string;
  status: string;
};

export default function TodayJobsTable({ rows, state, onRetry }: {
  rows: TodayJobRow[];
  state: DataTableState;
  onRetry: () => void;
}) {
  const columns: Column<TodayJobRow>[] = [
    {
      header: "Reference",
      cell: (row) => (
        <Link href={`/jobs?job=${encodeURIComponent(row.id)}`} className="inline-flex min-h-11 items-center rounded font-mono text-sm font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
          {row.reference || "Open job"}
          <span className="sr-only"> — open job details</span>
        </Link>
      ),
    },
    { header: "Customer", cell: (row) => row.customerName },
    {
      header: "Recorded status",
      cell: (row) => <span className="inline-flex rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">{(row.status || "Unknown").replaceAll("_", " ")}</span>,
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} state={state} onRetry={onRetry} errorMessage="Today's jobs could not be loaded." emptyTitle="No jobs scheduled today" emptyDescription="Check the jobs board for other dates and recorded completion evidence." emptyAction={<Link href="/jobs" className="text-sm font-semibold text-primary hover:underline">Open jobs board</Link>} />;
}
