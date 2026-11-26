import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../lib/api/server";
import { requireSubcontractorPortal } from "../../../../lib/accounts/subcontractorPortal";
import { parseSubcontractorDetails, SUBCONTRACTOR_DETAIL_COLUMNS } from "../../../../lib/accounts/subcontractorDetails";
import { subcontractorApiError } from "../../../../lib/subcontractors/server";
import {
  PORTAL_EMPLOYEE_COLUMNS,
  PORTAL_JOB_COLUMNS,
  PORTAL_SUBCONTRACTOR_COLUMNS,
  PORTAL_VEHICLE_COLUMNS,
  portalScopeFor,
} from "../../../../lib/accounts/portalScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmployeeRow = {
  id: string;
  directly_employed: boolean | null;
  active: boolean | null;
  employment_end_date: string | null;
  [key: string]: unknown;
};

type UserLinkRow = {
  id: string;
  employee_id: string;
  user_id: string | null;
  role: string;
  active: boolean;
  created_at: string | null;
};

const EMPTY = { data: [], error: null } as const;
const ADMIN_COMPANY_COLUMNS = [...new Set(
  `${PORTAL_SUBCONTRACTOR_COLUMNS},${SUBCONTRACTOR_DETAIL_COLUMNS}`.split(","),
)].join(",");

/*
  Review ACC-12: the payload depends on the portal role (see
  lib/accounts/portalScope.ts) and uses explicit column lists. A user linked to
  several subcontractors no longer gets a 500: the `link` query parameter picks
  one of their links, otherwise the oldest is used, and `links` lists them all.
*/
export async function GET(request: NextRequest) {
  try {
    const { admin, link: portalUser, links, employee } =
      await requireSubcontractorPortal(request.nextUrl.searchParams.get("link"));
    const scope = portalScopeFor(portalUser.role);
    const tenantId = portalUser.tenant_id;
    const subcontractorId = portalUser.subcontractor_id;

    const [subcontractorResult, jobsResult, vehiclesResult, employeesResult, usersResult] =
      await Promise.all([
        admin
          .from("subcontractors")
          .select(scope.portalUsers ? ADMIN_COMPANY_COLUMNS : PORTAL_SUBCONTRACTOR_COLUMNS)
          .eq("id", subcontractorId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),

        scope.jobs
          ? admin
              .from("jobs")
              .select(scope.jobCost ? `${PORTAL_JOB_COLUMNS},subcontractor_cost` : PORTAL_JOB_COLUMNS)
              .eq("tenant_id", tenantId)
              .eq("subcontractor_id", subcontractorId)
              .order("job_date", { ascending: false })
              .limit(100)
          : Promise.resolve(EMPTY),

        scope.vehicles
          ? admin
              .from("subcontractor_vehicles")
              .select(PORTAL_VEHICLE_COLUMNS)
              .eq("tenant_id", tenantId)
              .eq("subcontractor_id", subcontractorId)
              .order("registration")
          : Promise.resolve(EMPTY),

        scope.employees
          ? admin
              .from("subcontractor_employees")
              .select(PORTAL_EMPLOYEE_COLUMNS)
              .eq("tenant_id", tenantId)
              .eq("subcontractor_id", subcontractorId)
              .order("full_name")
          : Promise.resolve(EMPTY),

        scope.portalUsers
          ? admin
              .from("subcontractor_users")
              .select("id, employee_id, user_id, role, active, created_at")
              .eq("tenant_id", tenantId)
              .eq("subcontractor_id", subcontractorId)
              .order("created_at")
          : Promise.resolve(EMPTY),
      ]);

    const firstError =
      subcontractorResult.error ||
      jobsResult.error ||
      vehiclesResult.error ||
      employeesResult.error ||
      usersResult.error;

    if (firstError) {
      throw new Error(`subcontractor portal lookup failed: ${firstError.code ?? ""}`);
    }

    if (!subcontractorResult.data) throw new ApiError(403, "Portal access unavailable.");

    const userRows = (usersResult.data ?? []) as unknown as UserLinkRow[];
    const employeeRows = (employeesResult.data ?? []) as unknown as EmployeeRow[];

    const userIds = Array.from(
      new Set(userRows.map((row) => row.user_id).filter((value): value is string => Boolean(value)))
    );

    let publicUsersById = new Map<string, { id: string; email: string | null }>();

    if (userIds.length > 0) {
      const { data: publicUsers, error: publicUsersError } = await admin
        .from("users")
        .select("id, email")
        .in("id", userIds);

      if (publicUsersError) {
        throw new Error(`users lookup failed: ${publicUsersError.code ?? ""}`);
      }

      publicUsersById = new Map((publicUsers ?? []).map((row) => [row.id, row]));
    }

    const employeesById = new Map(employeeRows.map((row) => [row.id, row]));

    const portalUsers = userRows.map((row) => ({
      ...row,
      email: row.user_id ? publicUsersById.get(row.user_id)?.email ?? null : null,
      employee: employeesById.get(row.employee_id) ?? null,
    }));

    return NextResponse.json({
      portalUser: {
        id: portalUser.id,
        tenant_id: portalUser.tenant_id,
        subcontractor_id: portalUser.subcontractor_id,
        employee_id: portalUser.employee_id,
        user_id: portalUser.user_id,
        role: portalUser.role,
        active: portalUser.active,
      },
      links: links.map((link) => ({
        id: link.id,
        subcontractorId: link.subcontractor_id,
        role: link.role,
      })),
      subcontractor: subcontractorResult.data,
      employee,
      jobs: jobsResult.data ?? [],
      vehicles: vehiclesResult.data ?? [],
      employees: employeeRows,
      portalUsers,
    });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor portal");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== request.nextUrl.origin) throw new ApiError(403, "Invalid request origin.");
    const { admin, link } = await requireSubcontractorPortal(request.nextUrl.searchParams.get("link"));
    if (link.role !== "subcontractor_admin") throw new ApiError(403, "Only a subcontractor admin can edit company details.");
    const parsed = parseSubcontractorDetails(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Check the company details, email addresses and expiry dates.");
    const { data, error } = await admin.from("subcontractors")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", link.subcontractor_id).eq("tenant_id", link.tenant_id).eq("active", true)
      .select("id").maybeSingle();
    if (error) throw apiDbError(error, "Unable to save company details.");
    if (!data) throw new ApiError(404, "Company not found.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor details");
  }
}
