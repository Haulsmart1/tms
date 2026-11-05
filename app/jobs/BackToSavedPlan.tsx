"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buttonClasses } from "../../components/Button";
import { createClient } from "../../lib/supabase/browser";
import { findSavedPlanForJob, planningReturnHref, readPlanningReturnContext, validPlanningDate,
  type PlanningReturnContext } from "../../lib/planning/navigation";

export default function BackToSavedPlan({ jobId, tenantId, planningDate, vehicleId }: {
  jobId: string; tenantId: string; planningDate?: string | null; vehicleId?: string | null;
}) {
  const client = useMemo(() => createClient(), []);
  const [target, setTarget] = useState<{ jobId: string; context: PlanningReturnContext } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    const origin = readPlanningReturnContext(window.location.search, true);
    const context = origin?.tenantId === tenantId ? origin : null;
    if (context) setTarget({ jobId, context });
    if (!context?.planId) {
      void findSavedPlanForJob(client, tenantId, jobId, context?.date).then((plan) => {
        if (!cancelled && plan) setTarget({ jobId, context: { tenantId, planId: plan.id,
          date: plan.planning_date, vehicleId: context?.vehicleId ?? vehicleId ?? null } });
      }).catch(() => { /* The date-based Planning link stays available. */ });
    }
    return () => { cancelled = true; };
  }, [client, jobId, tenantId, vehicleId]);
  const context = target?.jobId === jobId ? target.context : null;
  const fallback = validPlanningDate(planningDate) ? `/planning?date=${planningDate}` : "/planning";
  return <Link href={context ? planningReturnHref(context) : fallback} className={buttonClasses("secondary")}>
    {context?.planId ? "Back to saved plan" : "Back to Planning"}
  </Link>;
}
