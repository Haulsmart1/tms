import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUB_ROLES = new Set([
  "subcontractor_admin",
  "dispatcher",
  "driver",
  "accounts",
]);

async function userClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase public env vars.");

  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env vars.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    "https://tmswizard.cloud"
  );
}

async function requireAdmin(tenantId: string) {
  const client = await userClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error("UNAUTHENTICATED");

  const admin = adminClient();
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);
  if (!membership || !["admin", "super_admin"].includes(membership.role)) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user };
}

async function findAuthUser(admin: ReturnType<typeof adminClient>, email: string) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);

    const match = data.users.find(
      (u) => u.email?.trim().toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function ensurePublicUser(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  email: string
) {
  const { data, error } = await admin
    .from("users")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data) {
    const { error: insertError } = await admin
      .from("users")
      .insert({ id: userId, email });
    if (insertError) throw new Error(insertError.message);
  }
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "Choose a tenant." }, { status: 400 });
    }

    const { admin } = await requireAdmin(tenantId);

    const [drivers, subcontractors, employees, driverUsers, subUsers] =
      await Promise.all([
        admin
          .from("drivers")
          .select("id,name,email,phone,active,driver_type")
          .eq("tenant_id", tenantId)
          .order("name"),
        admin
          .from("subcontractors")
          .select("id,name,subcontractor_type,active")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("name"),
        admin
          .from("subcontractor_employees")
          .select(
            "id,subcontractor_id,full_name,email,job_title,directly_employed,active,employment_end_date"
          )
          .eq("tenant_id", tenantId)
          .order("full_name"),
        admin
          .from("driver_users")
          .select("id,driver_id,user_id,active")
          .eq("tenant_id", tenantId),
        admin
          .from("subcontractor_users")
          .select("id,subcontractor_id,employee_id,user_id,role,active")
          .eq("tenant_id", tenantId),
      ]);

    const err =
      drivers.error ||
      subcontractors.error ||
      employees.error ||
      driverUsers.error ||
      subUsers.error;

    if (err) throw new Error(err.message);

    return NextResponse.json({
      drivers: drivers.data ?? [],
      subcontractors: subcontractors.data ?? [],
      employees: employees.data ?? [],
      driverUsers: driverUsers.data ?? [],
      subcontractorUsers: subUsers.data ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    if (!tenantId) {
      return NextResponse.json({ error: "Choose a tenant." }, { status: 400 });
    }

    const { admin, user: inviter } = await requireAdmin(tenantId);

    if (body.type === "driver") {
      const driverId = String(body.driverId ?? "").trim();
      if (!driverId) {
        return NextResponse.json({ error: "Choose a driver." }, { status: 400 });
      }

      const { data: driver, error } = await admin
        .from("drivers")
        .select("id,name,email,active")
        .eq("id", driverId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!driver) return NextResponse.json({ error: "Driver not found." }, { status: 404 });
      if (driver.active === false) {
        return NextResponse.json({ error: "Driver is inactive." }, { status: 409 });
      }
      if (!driver.email) {
        return NextResponse.json({ error: "Driver needs an email address." }, { status: 400 });
      }

      const email = driver.email.trim().toLowerCase();
      const existing = await findAuthUser(admin, email);

      let userId: string;
      let inviteSent = false;

      if (existing) {
        userId = existing.id;
      } else {
        const { data, error: inviteError } =
          await admin.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${siteUrl()}/api/auth/callback?next=/driver/dashboard`,
            data: {
              portal: "driver",
              tenant_id: tenantId,
              driver_id: driver.id,
              invited_by: inviter.id,
            },
          });

        if (inviteError) {
          return NextResponse.json({ error: inviteError.message }, { status: 400 });
        }
        if (!data.user?.id) throw new Error("Invite returned no user ID.");
        userId = data.user.id;
        inviteSent = true;
      }

      await ensurePublicUser(admin, userId, email);

      const { data: existingLink, error: linkError } = await admin
        .from("driver_users")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("driver_id", driver.id)
        .maybeSingle();

      if (linkError) throw new Error(linkError.message);

      if (existingLink) {
        const { error: updateError } = await admin
          .from("driver_users")
          .update({
            user_id: userId,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingLink.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await admin
          .from("driver_users")
          .insert({
            tenant_id: tenantId,
            driver_id: driver.id,
            user_id: userId,
            active: true,
          });
        if (insertError) throw new Error(insertError.message);
      }

      return NextResponse.json({
        ok: true,
        message: inviteSent
          ? `Driver invitation sent to ${email}.`
          : `${email} already had an account and now has driver portal access.`,
      });
    }

    if (body.type === "subcontractor") {
      const employeeId = String(body.employeeId ?? "").trim();
      const role = String(body.role ?? "").trim().toLowerCase();

      if (!employeeId || !SUB_ROLES.has(role)) {
        return NextResponse.json(
          { error: "Choose an employee and valid portal role." },
          { status: 400 }
        );
      }

      const { data: employee, error } = await admin
        .from("subcontractor_employees")
        .select(
          "id,subcontractor_id,full_name,email,directly_employed,active,employment_end_date"
        )
        .eq("id", employeeId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!employee) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }

      const today = new Date().toISOString().slice(0, 10);
      if (
        employee.directly_employed !== true ||
        employee.active !== true ||
        (employee.employment_end_date && employee.employment_end_date < today)
      ) {
        return NextResponse.json(
          { error: "Only active, directly employed employees can be invited." },
          { status: 409 }
        );
      }

      if (!employee.email) {
        return NextResponse.json({ error: "Employee needs an email address." }, { status: 400 });
      }

      const email = employee.email.trim().toLowerCase();
      const existing = await findAuthUser(admin, email);

      let userId: string;
      let inviteSent = false;

      if (existing) {
        userId = existing.id;
      } else {
        const next = role === "driver" ? "/driver/dashboard" : "/subcontractor/dashboard";

        const { data, error: inviteError } =
          await admin.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${siteUrl()}/api/auth/callback?next=${encodeURIComponent(next)}`,
            data: {
              portal: "subcontractor",
              tenant_id: tenantId,
              subcontractor_id: employee.subcontractor_id,
              employee_id: employee.id,
              role,
              invited_by: inviter.id,
            },
          });

        if (inviteError) {
          return NextResponse.json({ error: inviteError.message }, { status: 400 });
        }
        if (!data.user?.id) throw new Error("Invite returned no user ID.");
        userId = data.user.id;
        inviteSent = true;
      }

      await ensurePublicUser(admin, userId, email);

      const { data: link, error: linkError } = await admin
        .from("subcontractor_users")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("subcontractor_id", employee.subcontractor_id)
        .eq("employee_id", employee.id)
        .maybeSingle();

      if (linkError) throw new Error(linkError.message);

      if (link) {
        const { error: updateError } = await admin
          .from("subcontractor_users")
          .update({
            user_id: userId,
            role,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", link.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await admin
          .from("subcontractor_users")
          .insert({
            tenant_id: tenantId,
            subcontractor_id: employee.subcontractor_id,
            employee_id: employee.id,
            user_id: userId,
            role,
            active: true,
          });
        if (insertError) throw new Error(insertError.message);
      }

      return NextResponse.json({
        ok: true,
        message: inviteSent
          ? `Subcontractor portal invitation sent to ${email}.`
          : `${email} already had an account and now has subcontractor portal access.`,
      });
    }

    return NextResponse.json({ error: "Unknown invite type." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
