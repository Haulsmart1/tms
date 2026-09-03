import type { TenantStatus } from "../tenant/context";

type Args = {
  /** From useTenant().status. */
  tenantStatus: TenantStatus;
  /** From useTenant().activeTenantId. Null in TWO unrelated situations. */
  activeTenantId: string | null;
  /** The page's own in-flight query. */
  fetching: boolean;
  /* Only the length is read, so this stays free of any app/ type and lib/
     keeps its one-way dependency on app/. */
  users: readonly unknown[];
};

/* One derived value rather than three independent booleans, because the four
   states are mutually exclusive BY ORDER and three booleans would let a future
   edit put them in the wrong one.

   The order matters and is not arbitrary. activeTenantId is null both while the
   context resolves AND when a resolved admin sits on "All tenants", so testing
   null before status would show "pick a tenant" for a frame on every cold load:
   a worse flash than the one this project exists to remove.

   It lives in lib/ rather than beside the page because vitest covers lib/ only,
   and that ordering is the whole substance of the fix. See usersView.test.ts. */
export type UsersView = "loading" | "no-tenant-selected" | "empty" | "list";

export function usersView({
  tenantStatus,
  activeTenantId,
  fetching,
  users,
}: Args): UsersView {
  if (users.length > 0) return "list";           // never skeleton over content
  if (tenantStatus !== "ready") return "loading";
  if (!activeTenantId) return "no-tenant-selected";
  if (fetching) return "loading";
  return "empty";
}
