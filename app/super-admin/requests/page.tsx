import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import Badge from "../../../components/Badge";

/* Server component. Reads with the normal (anon-key + session cookie) client,
   NOT the service role, so the RLS policy is doing the real work: only a
   super_admin session can see these rows. The layout's role guard is the first
   layer, RLS is the second, and neither alone is trusted.

   Uses the design system (`ds`) rather than the inline styles of the sibling
   super-admin pages. It is a new page and this is the direction of travel;
   say the word if you would rather it matched its neighbours for now. */

type RegistrationRequest = {
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

export default async function AccessRequestsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("registration_requests")
    .select("id, company_name, contact_name, email, phone, vehicle_count, notes, status, created_at")
    .order("created_at", { ascending: false });

  const requests = (data ?? []) as RegistrationRequest[];

  /* An empty result is AMBIGUOUS and must not be reported as "no requests".
     When RLS filters every row, PostgREST returns 200 with an empty array, not
     an error, so a missing or mismatched read policy looks exactly like an
     empty table. Left unhandled, the page would confidently say "No requests
     yet" while real leads accumulate and nobody investigates.

     Cross-check the true row count with the service role (server-only, bypasses
     RLS) so the two cases can be told apart. */
  let hiddenByPolicy = 0;
  if (!error && requests.length === 0) {
    try {
      const admin = createAdminClient();
      const { count } = await admin
        .from("registration_requests")
        .select("id", { count: "exact", head: true });
      hiddenByPolicy = count ?? 0;
    } catch {
      // Service role not configured. Fall through to the plain empty state.
    }
  }

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <p className="text-overline uppercase text-ink-2">Sales</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Access requests</h1>
        <p className="mt-1 text-sm text-ink-2">
          Submissions from the landing page form, newest first.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-danger-border bg-danger-tint p-4 text-sm text-danger-strong"
          >
            Could not load requests. If this persists, check that the
            registration_requests read policy allows super admins.
          </div>
        ) : hiddenByPolicy > 0 ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-warning-border bg-warning-tint p-4 text-sm text-warning-strong"
          >
            <p className="font-semibold">
              {hiddenByPolicy} request{hiddenByPolicy === 1 ? " exists" : "s exist"} but your
              session cannot see {hiddenByPolicy === 1 ? "it" : "them"}.
            </p>
            <p className="mt-1">
              This is a Row Level Security misconfiguration, not an empty table. Run
              docs/sql/registration_requests_rls.sql and confirm the read policy&apos;s
              profiles-to-roles join matches how super_admin is actually stored.
            </p>
          </div>
        ) : requests.length === 0 ? (
          <div className="mt-6 rounded-lg border border-line bg-surface p-8 text-center">
            <p className="text-base font-semibold text-ink">No requests yet</p>
            <p className="mt-1 text-sm text-ink-2">
              New submissions from the landing page will appear here. If you are expecting
              requests, confirm the registration_requests read policy has been applied.
            </p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
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
                {requests.map((r) => (
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
                      {r.phone ? (
                        <div className="text-xs text-ink-3">{r.phone}</div>
                      ) : null}
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
      </div>
    </div>
  );
}
