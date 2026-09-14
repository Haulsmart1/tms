import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createUserClient } from "../../../../lib/accounts/server";
import { GENERIC_ERROR_MESSAGE } from "../../../../lib/accounts/errors";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import {
  PORTAL_EMPLOYEE_COLUMNS,
  PORTAL_JOB_COLUMNS,
  PORTAL_SUBCONTRACTOR_COLUMNS,
  PORTAL_VEHICLE_COLUMNS,
  pickPortalLink,
  portalScopeFor,
} from "../../../../lib/accounts/portalScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PortalLinkRow = {
  id: string;
  tenant_id: string;
  subcontractor_id: string;
  employee_id: string;
  user_id: string;
  role: string;
  active: boolean;
  created_at: string | null;
};

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

/*
  Review ACC-12: the payload depends on the portal role (see
  lib/accounts/portalScope.ts) and uses explicit column lists. A user linked to
  several subcontractors no longer gets a 500: the `link` query parameter picks
  one of their links, otherwise the oldest is used, and `links` lists them all.
*/
export async function GET(request: NextRequest) {
  try {
    const userClient = await createUserClient();

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const requestedLink = request.nextUrl.searchParams.get("link")?.trim() || null;

    if (requestedLink && !isUuid(requestedLink)) {
      return NextResponse.json({ error: "No active subcontractor portal access was found." }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: linkRows, error: linksError } = await admin
      .from("subcontractor_users")
      .select("id, tenant_id, subcontractor_id, employee_id, user_id, role, active, created_at")
      .eq("user_id", user.id)
      .eq("active", true);

    if (linksError) {
      throw new Error(`subcontractor_users lookup failed: ${linksError.code ?? ""}`);
    }

    const links = (linkRows ?? []) as PortalLinkRow[];
    const portalUser = pickPortalLink(links, requestedLink);

    if (!portalUser) {
      return NextResponse.json({ error: "No active subcontractor portal access was found." }, { status: 403 });
    }

    const scope = portalScopeFor(portalUser.role);
    const tenantId = portalUser.tenant_id;
    const subcontractorId = portalUser.subcontractor_id;

    const [subcontractorResult, employeeResult, jobsResult, vehiclesResult, employeesResult, usersResult] =
      await Promise.all([
        admin
          .from("subcontractors")
          .select(PORTAL_SUBCONTRACTOR_COLUMNS)
          .eq("id", subcontractorId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),

        admin
          .from("subcontractor_employees")
          .select(PORTAL_EMPLOYEE_COLUMNS)
          .eq("id", portalUser.employee_id)
          .eq("subcontractor_id", subcontractorId)
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
      employeeResult.error ||
      jobsResult.error ||
      vehiclesResult.error ||
      employeesResult.error ||
      usersResult.error;

    if (firstError) {
      throw new Error(`subcontractor portal lookup failed: ${firstError.code ?? ""}`);
    }

    const employee = employeeResult.data as unknown as EmployeeRow | null;

    if (!subcontractorResult.data || !employee) {
      return NextResponse.json({ error: "Subcontractor portal record is incomplete." }, { status: 403 });
    }

    if (
      employee.directly_employed !== true ||
      employee.active !== true ||
      (employee.employment_end_date &&
        employee.employment_end_date < new Date().toISOString().slice(0, 10))
    ) {
      return NextResponse.json(
        { error: "Your employment record is not eligible for portal access." },
        { status: 403 }
      );
    }

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
    console.error("Subcontractor portal GET failed:", error);

    return NextResponse.json({ error: GENERIC_ERROR_MESSAGE, code: "internal_error" }, { status: 500 });
  }
}
