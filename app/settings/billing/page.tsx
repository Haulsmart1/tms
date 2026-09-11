"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import V1Billing from "./V1Billing";
import V2Billing from "./V2Billing";

/* Shell for the billing page. Owns the role gates and ONE query, then hands
   off to the body for whichever billing model this company is on.

   Two models run side by side (see CLAUDE.md): v1_immediate charges in advance
   every 4 weeks, v2_period bills in arrears when a 28-day period closes. They
   have different pricing shapes, different tables and different vocabulary, so
   they get a body each rather than a shared one full of conditionals. */

type BillingModelRow = {
  billing_model?: string | null;
};

function PageFrame({
  description,
  children,
}: {
  /* Withheld rather than defaulted while the model is unknown. Defaulting to
     the v1 sentence would flash "£10 per active licensed vehicle per week" at
     a v2 admin before correcting itself, and a wrong price shown briefly is
     worse than an obvious loading state. */
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Billing
            </h1>
            <p className="m-0 text-sm text-ink-3">{description}</p>
          </header>
          {children}
        </main>
      </div>
    </TenantGate>
  );
}

export default function BillingSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [model, setModel] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const loadModel = useCallback(async () => {
    setModelError(null);
    try {
      /* select("*") is deliberate and must not be narrowed to the columns
         actually used. billing_model is a billing_06 column: on a deploy where
         that migration has not been applied, "*" returns a row without the
         field and the company reads as v1, which is correct. An explicit
         select("billing_model, ...") would instead answer PostgREST 42703 and
         fail this page for EVERY v1 company. */
      const { data, error } = await supabase
        .from("company_billing")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      setModel((data as BillingModelRow | null)?.billing_model ?? null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setModelLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    /* Only the one role that can see this page. A super_admin's RLS scope
       returns every company's rows, so maybeSingle() would error. */
    if (tenant.status !== "ready" || tenant.role !== "admin") return;
    void loadModel();
  }, [loadModel, tenant.status, tenant.role]);

  /* Role gates apply only once status is ready. Before that, role is the
     provider's placeholder and every admin would see the staff notice flash. */
  if (tenant.status === "ready" && tenant.role === "super_admin") {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="info">
          Platform billing for all companies lives in the super-admin console.{" "}
          <Link href="/super-admin/billing" className="underline">
            Go to super-admin billing
          </Link>
        </MessageBanner>
      </PageFrame>
    );
  }

  if (tenant.status === "ready" && tenant.role !== "admin") {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="info">
          Billing is managed by your company admin.
        </MessageBanner>
      </PageFrame>
    );
  }

  if (!modelLoaded) {
    return (
      <PageFrame description={<Skeleton display="inline-block" w="34ch" h="0.875rem" />}>
        <span className="sr-only" role="status">
          Loading billing
        </span>
      </PageFrame>
    );
  }

  if (modelError) {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="danger">
          Could not load billing data: {modelError}
        </MessageBanner>
      </PageFrame>
    );
  }

  /* FAIL CLOSED on anything that is not exactly the v2 string, undefined
     included. A company wrongly rendered as v1 sees a stale but harmless page;
     one wrongly rendered as v2 sees a bill that does not exist. */
  const isV2 = model === "v2_period";

  return isV2 ? (
    <PageFrame description={<V2Billing.Description />}>
      <V2Billing />
    </PageFrame>
  ) : (
    <PageFrame description={<V1Billing.Description />}>
      <V1Billing />
    </PageFrame>
  );
}
