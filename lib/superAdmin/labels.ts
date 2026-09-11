/* Display labels shared between the /super-admin/companies badges and its
   search fields. lib/superAdmin/search.ts states the rule this module
   exists to satisfy: pass the string the table renders, not the raw value.
   Without one shared helper, the badge text and the search fields drift
   apart the first time a label stops being a mechanical de-underscoring of
   its raw value (a `canceled` status shown as "cancelled", say), and search
   would silently return nothing for the word actually on screen. */

const BILLING_MODEL_LABELS: Record<string, string> = {
  v1_immediate: "v1 immediate",
  v2_period: "v2 period",
};

export function billingModelLabel(model: string | null): string {
  if (!model) return "unknown";
  return BILLING_MODEL_LABELS[model] ?? model;
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "active",
  past_due: "past due",
};

/* degraded distinguishes two facts that both leave status === null: a
   company with no billing row at all (there IS no subscription, "none" is
   true), and a company_billing read that failed (there might be one, it
   just could not be read, so "none" would be a false claim). Callers must
   not collapse the two into one string. */
export function subscriptionStatusLabel(status: string | null, degraded: boolean): string {
  if (degraded) return "unknown";
  if (!status) return "none";
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status;
}
