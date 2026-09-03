import type { TenantStatus } from "../tenant/context";

type Args = {
  /** From useTenant().status. */
  tenantStatus: TenantStatus;
  /** From useTenant().activeTenantId. Null in TWO unrelated situations. */
  activeTenantId: string | null;
  /** The page's own in-flight query. */
  fetching: boolean;
  /** Whether this region has already rendered real content at least once. */
  hasData: boolean;
  /** The tenant the on-screen content was loaded FOR. `undefined` before any
   *  load has completed, which is deliberately distinct from `null`
   *  ("All tenants"). */
  dataTenantId: string | null | undefined;
  /** Whether the last completed read for this region threw. */
  failed: boolean;
};

/* Which of five things a tenant-scoped list region should render. One derived
   value rather than a stack of independent booleans, because the states are
   mutually exclusive BY ORDER and separate booleans would let a future edit
   put a page in the wrong one.

   The order matters and is not arbitrary:
   - activeTenantId is null both while the context resolves AND when a resolved
     admin sits on "All tenants", so testing null before status would show
     "pick a tenant" for a frame on every cold load: a worse flash than the one
     this project exists to remove.
   - "error" sits before "fetching" so a retry in flight does not mask the
     failure the user is still looking at, and after "no-tenant-selected" so a
     stale failure does not outrank the prompt to pick a tenant.

   SIBLING: lib/loading/skeletonVisibility.ts is the SAME underlying rule
   expressed as a boolean for a two-way branch, where this expresses it for a
   five-way one. The hasData short circuit and the `status !== "ready" ||
   fetching` pair appear in both. They must change together; deliberately not
   composed, because composing hides the ordering, and the ordering is the
   substance here.

   hasData ALSO REQUIRES dataTenantId === activeTenantId. Content counts as
   "already on screen" only if it belongs to the tenant currently selected:
   otherwise switching tenants left the previous tenant's rows on screen
   (hasData true) reported as "list" under the new tenant's selection.
   dataTenantId is three-valued so a never-loaded region (`undefined`) is not
   mistaken for a match against "All tenants" (`null`).

   It lives in lib/ rather than beside a page because vitest covers lib/ only.
   See tenantDataView.test.ts. */
export type TenantDataView =
  | "loading"
  | "no-tenant-selected"
  | "error"
  | "empty"
  | "list";

export function tenantDataView({
  tenantStatus,
  activeTenantId,
  fetching,
  hasData,
  dataTenantId,
  failed,
}: Args): TenantDataView {
  if (hasData && dataTenantId === activeTenantId) return "list"; // never skeleton over content for the selected tenant
  if (tenantStatus !== "ready") return "loading";
  if (!activeTenantId) return "no-tenant-selected";
  if (failed) return "error";                    // do NOT claim empty after a failed read
  if (fetching) return "loading";
  return "empty";
}
