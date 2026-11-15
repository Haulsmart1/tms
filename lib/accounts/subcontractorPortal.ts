import "server-only";
import { ApiError, apiDbError } from "../api/server";
import { isUuid } from "../auth/serverTenantAccess";
import { PORTAL_EMPLOYEE_COLUMNS, pickPortalLink } from "./portalScope";
import { createAdminClient, createUserClient } from "./server";

export type PortalLinkRow = {
  id: string;
  tenant_id: string;
  subcontractor_id: string;
  employee_id: string;
  user_id: string;
  role: string;
  active: boolean;
  created_at: string | null;
};

export async function requireSubcontractorPortal(requestedLink: string | null) {
  const userClient = await createUserClient();
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new ApiError(401, "You must be signed in.");
  if (requestedLink && !isUuid(requestedLink)) throw new ApiError(403, "Portal access unavailable.");

  const admin = createAdminClient();
  const result = await admin.from("subcontractor_users")
    .select("id, tenant_id, subcontractor_id, employee_id, user_id, role, active, created_at")
    .eq("user_id", user.id).eq("active", true);
  if (result.error) throw apiDbError(result.error, "Unable to verify portal access.");
  const links = (result.data ?? []) as PortalLinkRow[];
  const link = pickPortalLink(links, requestedLink);
  if (!link) throw new ApiError(403, "Portal access unavailable.");

  const [employeeResult, companyResult] = await Promise.all([
    admin.from("subcontractor_employees").select(PORTAL_EMPLOYEE_COLUMNS)
      .eq("id", link.employee_id).eq("tenant_id", link.tenant_id)
      .eq("subcontractor_id", link.subcontractor_id).maybeSingle(),
    admin.from("subcontractors").select("active").eq("id", link.subcontractor_id)
      .eq("tenant_id", link.tenant_id).maybeSingle(),
  ]);
  if (employeeResult.error || companyResult.error) {
    throw apiDbError((employeeResult.error || companyResult.error)!, "Unable to verify portal access.");
  }
  const employee = employeeResult.data;
  if (!companyResult.data?.active || !employee?.active || !employee.directly_employed ||
    (employee.employment_end_date && employee.employment_end_date < new Date().toISOString().slice(0, 10))) {
    throw new ApiError(403, "Portal access unavailable.");
  }
  return { admin, link, links, employee };
}
