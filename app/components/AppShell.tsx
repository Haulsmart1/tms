"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings, LogOut,
  type LucideIcon,
} from "lucide-react";
import { useTenant } from "./TenantProvider";
import TenantSelector from "./TenantSelector";
import Logo from "../../components/Logo";
import { NAV_GROUPS } from "../../lib/nav/navConfig";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";
import { createClient } from "../../lib/supabase/browser";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings,
};

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, role, userEmail } = useTenant();

  if (!shouldShowShell(pathname, status)) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();

  // sticky top-0 (with h-screen) keeps the sidebar pinned to the viewport as the
  // page scrolls — without it, the aside has an explicit height so flexbox's
  // stretch never grows it, and it scrolls away on any page taller than 100vh.
  return (
    <aside className="ds sticky top-0 flex h-screen w-[220px] flex-none flex-col bg-chrome font-sans">
      <div className="flex flex-none items-center gap-2 border-b border-chrome-border px-4 py-4">
        <Logo variant="tile" size={28} />
        <span className="text-sm font-semibold text-chrome-text-strong">TMS Wizzard</span>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto p-2.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "root"}>
            {group.label ? (
              <div className="px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-semibold no-underline " +
                    (active
                      ? "bg-primary text-on-primary"
                      : "text-chrome-text hover:bg-chrome-raised hover:text-chrome-text-strong")
                  }
                >
                  <Icon size={16} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-none items-center gap-2.5 border-t border-chrome-border p-3.5">
        <span
          aria-hidden
          className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-chrome-text-strong">
            {userEmail ?? "Signed in"}
          </span>
          {role === "super_admin" ? (
            <Link href="/super-admin" className="block truncate text-xs font-medium text-chrome-link no-underline hover:text-white">
              Super Admin
            </Link>
          ) : null}
        </span>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-raised text-chrome-text shadow-xs transition-colors hover:border-danger hover:bg-danger hover:text-on-danger"
        >
          <LogOut size={15} aria-hidden />
        </button>
      </div>
      <div className="border-t border-chrome-border p-2">
        <TenantSelector />
      </div>
    </aside>
  );
}
