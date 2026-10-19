"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings, LogOut,
  Menu, X, Search, ChevronRight,
  Route, Clock,
  type LucideIcon,
} from "lucide-react";
import { useTenant } from "./TenantProvider";
import TenantSelector from "./TenantSelector";
import Logo from "../../components/Logo";
import { isNavItemActive } from "../../lib/nav/navConfig";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";
import { createClient } from "../../lib/supabase/browser";
import ThemeToggle from "./ThemeToggle";
import { isThemeableRoute } from "../../lib/nav/themeableRoutes";
import { filterOperationNavigation, operationRouteLabel } from "./operationsNavigation";
import styles from "./operationsShell.module.css";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings,
  Route, Clock,
};

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, role, userEmail } = useTenant();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => { setNavigationOpen(false); setNavigationQuery(""); }, [pathname]);
  useEffect(() => {
    if (!navigationOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [menuButton.current, ...Array.from(
      navigation.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
      ) ?? [],
    )].filter((element): element is HTMLElement => !!element && element.getClientRects().length > 0);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setNavigationOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    const onDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    // A selector list follows DOM order; explicitly prefer the active page.
    const initialLink = navigation.current?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?? navigation.current?.querySelector<HTMLElement>('input[type="search"]')
      ?? navigation.current?.querySelector<HTMLElement>('a[href]');
    initialLink?.focus();
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [navigationOpen]);

  if (!shouldShowShell(pathname, status)) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();
  const groups = filterOperationNavigation(navigationQuery);

  // sticky top-0 (with h-screen) keeps the sidebar pinned to the viewport as the
  // page scrolls — without it, the aside has an explicit height so flexbox's
  // stretch never grows it, and it scrolls away on any page taller than 100vh.
  return (
    <>
    <button
      ref={menuButton}
      type="button"
      aria-expanded={navigationOpen}
      aria-controls="tms-primary-navigation"
      onClick={() => setNavigationOpen(!navigationOpen)}
      className="ds fixed inset-x-0 top-0 z-[60] flex h-14 items-center gap-3 border-b border-chrome-border bg-chrome px-4 text-left font-sans font-semibold text-chrome-text-strong shadow-sm lg:hidden"
    >
      {navigationOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      <span className={styles.mobileBrand}>TMS Wizard<span className={styles.mobilePage}>{operationRouteLabel(pathname)}</span></span>
      <span className="ml-auto text-xs font-medium text-chrome-text">{navigationOpen ? "Close menu" : "Menu"}</span>
    </button>
    {navigationOpen ? (
      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={() => { setNavigationOpen(false); menuButton.current?.focus(); }}
        tabIndex={-1}
        className="fixed inset-0 z-[45] bg-black/60 lg:hidden"
      />
    ) : null}
    <aside ref={navigation} id="tms-primary-navigation" className={`ds ${styles.sidebar} fixed left-0 top-0 z-50 h-[100dvh] w-[min(20rem,calc(100vw-2rem))] flex-none flex-col font-sans shadow-2xl lg:sticky lg:h-screen lg:w-[236px] lg:shadow-none ${navigationOpen ? 'flex' : 'hidden lg:flex'}`}>
      <div className={`${styles.brand} flex flex-none items-center gap-3 border-b border-chrome-border`}>
        <Logo variant="tile" size={34} decorative />
        <span><span className={`${styles.brandName} block font-semibold text-chrome-text-strong`}>TMS Wizard</span><span className={styles.eyebrow}>Transport workspace</span></span>
      </div>

      <div className={styles.workspace}>
        <div className={styles.shortcuts} aria-label="Operational shortcuts">
          <Link href="/jobs" className={styles.shortcut}><ClipboardList size={15} aria-hidden />Jobs board</Link>
          <Link href="/planning" className={styles.shortcut}><Route size={15} aria-hidden />Plan loads</Link>
        </div>
        <div className={styles.search}>
          <Search size={16} aria-hidden className={styles.searchIcon} />
          <input ref={searchInput} type="search" aria-label="Find a workspace page" placeholder="Find a workspace page" value={navigationQuery} onChange={(event) => setNavigationQuery(event.target.value)} className={styles.searchInput} />
          {navigationQuery ? <button type="button" aria-label="Clear navigation search" className={styles.clearSearch} onClick={() => { setNavigationQuery(""); searchInput.current?.focus(); }}><X size={15} aria-hidden /></button> : null}
        </div>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto p-2.5">
        {groups.length === 0 ? <p role="status" className={styles.empty}>No workspace pages match. Clear the search to see all sections.</p> : null}
        {groups.map((group) => (
          <div key={group.label ?? "root"}>
            {group.label ? (
              <div className={styles.groupTitle}>
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => {
                    if (navigationOpen) {
                      setNavigationOpen(false);
                      menuButton.current?.focus();
                    }
                  }}
                  aria-current={active ? "page" : undefined}
                  className={
                    `${styles.navLink} flex items-center gap-2.5 px-2.5 py-1.5 text-sm font-medium no-underline ` +
                    (active
                      ? "text-chrome-text-strong"
                      : "text-chrome-text hover:bg-chrome-raised hover:text-chrome-text-strong")
                  }
                >
                  <Icon size={17} aria-hidden className={styles.navIcon} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {active ? <ChevronRight size={14} aria-hidden className={styles.activeArrow} /> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={`${styles.account} flex flex-none items-center gap-2.5 border-t border-chrome-border p-3.5`}>
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
        {/* Hidden on legacy routes. AppShell renders everywhere, so an
            unguarded toggle on /pod would turn the sidebar light while the
            pinned page body stayed dark: visibly broken, not just
            inconsistent. See lib/nav/themeableRoutes.ts. */}
        {isThemeableRoute(pathname) ? <ThemeToggle /> : null}
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-raised text-chrome-text shadow-xs transition-colors hover:border-danger hover:bg-danger hover:text-on-danger"
        >
          <LogOut size={15} aria-hidden />
        </button>
      </div>
      {role !== "staff" ? <div className="border-t border-chrome-border p-3"><div className={styles.tenantLabel}>Workspace scope</div><TenantSelector /></div> : null}
    </aside>
    </>
  );
}
