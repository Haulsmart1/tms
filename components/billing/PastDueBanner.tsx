"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTenant } from "../../app/components/TenantProvider";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";
import { createClient } from "../../lib/supabase/browser";

// Fixed overlay shown to company admins while their subscription is past_due.
// RLS means the company_billing select returns at most the caller's own row.
export default function PastDueBanner() {
  const pathname = usePathname();
  const { role, status } = useTenant();
  const [pastDue, setPastDue] = useState(false);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("company_billing")
      .select("status")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPastDue(data?.status === "past_due");
      });
    return () => {
      cancelled = true;
    };
  }, [role, pathname]);

  if (!pastDue) return null;
  if (!shouldShowShell(pathname, status)) return null;
  if (pathname === "/settings/billing") return null;

  return (
    <div className="ds sticky top-0 z-50 flex w-full items-center justify-center gap-3 bg-danger px-4 py-2 font-sans text-sm font-semibold text-on-danger">
      <span>A subscription payment failed. Please update your card.</span>
      <Link href="/settings/billing" className="underline">
        Go to billing
      </Link>
    </div>
  );
}
