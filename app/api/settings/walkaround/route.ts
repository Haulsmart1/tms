import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../../lib/api/server";
import { authorizeTenant, TenantAccessError } from "../../../../lib/auth/serverTenantAccess";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { loadCatalogueRows } from "../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHONE_RE = /^[0-9 +()-]{6,32}$/;

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TenantAccessError) {
    if (error.status === 401) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    if (error.status === 403) {
      return NextResponse.json(
        { error: "You do not have permission to manage walkaround settings for this tenant." },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Unable to verify tenant access." }, { status: 500 });
  }
  console.error("[settings/walkaround] error", error);
  return NextResponse.json({ error: "Unable to load or save walkaround settings." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, tier } = await requireTenant(request);
    const admin = createAdminClient();
    const authorized = await authorizeTenant(admin, user.id, tenantId, "access");
    const companyId = authorized.tenant.companyId ?? tenantId;

    const [rows, settings] = await Promise.all([
      loadCatalogueRows(admin, companyId),
      admin.from("walkaround_settings").select("on_call_phone").eq("company_id", companyId).maybeSingle(),
    ]);
    if (settings.error) throw new Error(settings.error.message);

    return NextResponse.json({
      baseline: rows.filter((r) => r.companyId === null),
      companyItems: rows.filter((r) => r.companyId !== null),
      onCallPhone: settings.data?.on_call_phone ? String(settings.data.on_call_phone) : null,
      canEdit: tier === "admin" || tier === "super_admin",
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, tenantId } = await requireTenant(request);
    const admin = createAdminClient();
    const authorized = await authorizeTenant(admin, user.id, tenantId, "manage");
    const companyId = authorized.tenant.companyId ?? tenantId;

    let body: { onCallPhone?: unknown };
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const trimmed = typeof body.onCallPhone === "string" ? body.onCallPhone.trim() : "";
    let onCallPhone: string | null = null;
    if (trimmed) {
      if (!PHONE_RE.test(trimmed)) {
        throw new ApiError(400, "Enter a valid phone number.");
      }
      onCallPhone = trimmed;
    }

    const { error } = await admin.from("walkaround_settings").upsert(
      {
        company_id: companyId,
        on_call_phone: onCallPhone,
        updated_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, onCallPhone });
  } catch (error) {
    return handleError(error);
  }
}
