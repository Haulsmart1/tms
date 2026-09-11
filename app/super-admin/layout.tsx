import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { resolveSuperAdmin, superAdminDenial } from "../../lib/superAdmin/guard";

const NAV_LINKS = [
  { href: "/super-admin", label: "Overview" },
  { href: "/super-admin/companies", label: "Companies" },
  { href: "/super-admin/requests", label: "Requests" },
  { href: "/super-admin/users", label: "Users" },
  { href: "/super-admin/billing", label: "Billing" },
  { href: "/super-admin/invoices", label: "Invoices" },
];

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  /* Same helper the /api/super-admin routes use. Two hand-written copies of an
     authorization rule drift, and the copy that drifts is always the one
     nobody is looking at. */
  const session = await resolveSuperAdmin();
  const denial = superAdminDenial(session.userId, session.roleName);

  if (denial?.status === 401) {
    // /login, not /. The landing page no longer carries a sign-in form, so
    // sending a logged-out user there strands them with no way back in.
    redirect("/login");
  }

  if (denial) redirect("/dashboard");

  return (
    // No min-h-screen here: all seven /super-admin pages already carry it on
    // their own roots, and stacking a second one under the header made the
    // whole area scroll a little even when a page's content was empty.
    <div className="ds bg-canvas font-sans text-ink">
      <header className="border-b border-line bg-surface px-4 py-3 md:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2">
          <strong className="inline-flex items-center gap-1.5 text-md font-semibold text-ink">
            <Zap size={16} aria-hidden /> Super Admin
          </strong>

          {/* No active-link highlight: usePathname is a client hook and this
              is a server component, and splitting the nav into its own
              client component to underline one link is not worth a new
              component boundary. Each page carries its own <h1>, which is
              what tells the operator where they are. */}
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-ink-2 no-underline hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/dashboard"
            className="ml-auto text-sm font-medium text-ink-3 no-underline hover:text-ink"
          >
            ← Back to app
          </Link>
        </div>
      </header>

      <div>{children}</div>
    </div>
  );
}
