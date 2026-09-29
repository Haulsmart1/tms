import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../../../lib/api/server";
import { authorizeTenant, TenantAccessError } from "../../../../../lib/auth/serverTenantAccess";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { validateCompanyItem, type CompanyItemInput } from "../../../../../lib/walkaround/catalogue";
import { toCatalogueItem } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  console.error("[settings/walkaround/items] error", error);
  return NextResponse.json({ error: "Unable to save the item." }, { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId } = await requireTenant(request);
    const admin = createAdminClient();
    const authorized = await authorizeTenant(admin, user.id, tenantId, "manage");
    const companyId = authorized.tenant.companyId ?? tenantId;

    let body: CompanyItemInput;
    try {
      body = (await request.json()) as CompanyItemInput;
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const { data: existing, error: existingError } = await admin
      .from("defect_catalogue_items")
      .select("code")
      .eq("company_id", companyId);
    if (existingError) throw new Error(existingError.message);
    const existingCodes = new Set((existing ?? []).map((r) => String(r.code)));

    const validated = validateCompanyItem(body, existingCodes);
    if (!validated.ok) {
      throw new ApiError(400, validated.error);
    }

    const { data: maxRow, error: maxError } = await admin
      .from("defect_catalogue_items")
      .select("sort_order")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw new Error(maxError.message);
    const sortOrder = maxRow ? Number(maxRow.sort_order) + 10 : 10000;

    const { data: inserted, error: insertError } = await admin
      .from("defect_catalogue_items")
      .insert({
        company_id: companyId,
        code: validated.value.code,
        category: validated.value.category,
        item_label: validated.value.itemLabel,
        defect_label: validated.value.defectLabel,
        guidance: validated.value.guidance,
        severity: validated.value.severity,
        applies_to: validated.value.appliesTo,
        sort_order: sortOrder,
      })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({ item: toCatalogueItem(inserted as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
