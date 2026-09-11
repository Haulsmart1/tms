"use client";

import { useMemo, useState } from "react";
import Badge from "../../../components/Badge";
import MessageBanner from "../../../components/MessageBanner";
import SearchInput from "../../../components/SearchInput";
import { filterBySearch } from "../../../lib/superAdmin/search";

/* Client child of the server page next door. The page stays a server component
   because it does a service-role cross-check of the row count that must not
   move to the browser; only the rendering of rows it already fetched lives
   here, so search can be client state. */

export type RegistrationRequest = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vehicle_count: number | null;
  notes: string | null;
  status: string | null;
  created_at: string;
};

function statusTone(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
    case "accepted":
    case "complete":
    case "completed":
      return "success" as const;
    case "rejected":
    case "declined":
      return "danger" as const;
    case "contacted":
    case "in_progress":
      return "info" as const;
    case "new":
    case "pending":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

export default function RequestsTable({
  requests,
  hitRowCap,
}: {
  requests: RegistrationRequest[];
  // Computed server-side in page.tsx, against the actual read, and passed
  // down rather than recomputed here: this component only ever sees the
  // rows the server already fetched, never the query itself.
  hitRowCap: boolean;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      filterBySearch(query, requests, (request) => [
        request.company_name,
        request.contact_name,
        request.email,
        request.phone,
        // The rendered word, not the raw value: the badge falls back to
        // "unknown" on screen (see invoices/page.tsx for the same rule), so
        // a null status must be searchable as "unknown", not as nothing.
        request.status ?? "unknown",
        // Rendered directly under the company name and the largest
        // free-text field on the page; the most likely thing an operator
        // types.
        request.notes,
      ]),
    [query, requests],
  );

  return (
    <>
      {/* PostgREST caps an unscoped select at 1000 rows by default. A search
          box changes the symptom of hitting that cap: a truncated LIST
          reads as a short list, but a search over a truncated read reads as
          "no such request" -- the request may exist, just outside the 1000
          rows the server component ever saw. */}
      <MessageBanner tone="warning">
        {hitRowCap
          ? `This list returned 1000 or more rows, the PostgREST default cap. Some requests may be missing below, and a search here may report "no matches" for a request that exists but was never read.`
          : ""}
      </MessageBanner>

      <SearchInput
        id="request-search"
        label="Search requests"
        value={query}
        onChange={setQuery}
        placeholder="Search by company, contact, email, status"
        resultHint={query ? `${visible.length} of ${requests.length} requests` : undefined}
        wrapperClassName="mt-6"
      />

      {visible.length === 0 ? (
        // Only reachable via a non-empty query: page.tsx only renders this
        // component once requests.length > 0, so an empty `visible` here is
        // always a filtered miss, never the genuinely-empty case (that's
        // page.tsx's "No requests yet" branch).
        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
          No requests match &quot;{query}&quot;.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-overline uppercase text-ink-3">
                <th className="px-4 py-2 text-left font-semibold">Received</th>
                <th className="px-4 py-2 text-left font-semibold">Company</th>
                <th className="px-4 py-2 text-left font-semibold">Contact</th>
                <th className="px-4 py-2 text-right font-semibold">Vehicles</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-3">
                    {new Date(r.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.company_name ?? "-"}</div>
                    {r.notes ? (
                      <div className="mt-1 max-w-md text-xs text-ink-3">{r.notes}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{r.contact_name ?? "-"}</div>
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        className="text-xs text-primary hover:text-primary-hover"
                      >
                        {r.email}
                      </a>
                    ) : null}
                    {r.phone ? <div className="text-xs text-ink-3">{r.phone}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {r.vehicle_count ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.status)}>{r.status ?? "unknown"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
