import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../../../../lib/api/server";
import { authorizeTenant, isUuid, TenantAccessError } from "../../../../../../lib/auth/serverTenantAccess";
import { createAdminClient } from "../../../../../../lib/supabase/admin";
import { toCatalogueItem } from "../../../../../../lib/walkaround/server";
import type { Severity } from "../../../../../../lib/walkaround/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type ItemPatchBody = { severity?: unknown; guidance?: unknown; retired?: unknown };
const SEVERITIES: readonly Severity[] = ["minor", "dangerous"];

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

/*
  A baseline row (company_id null) is never editable from here; the WLK03
  trigger backs this up in the database in case a route bug lets one through.
*/
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }

    const { user, tenantId } = await requireTenant(request);
    const admin = createAdminClient();
    const authorized = await authorizeTenant(admin, user.id, tenantId, "manage");
    const companyId = authorized.tenant.companyId ?? tenantId;

    let body: ItemPatchBody;
    try {
      body = (await request.json()) as ItemPatchBody;
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const { data: row, error: rowError } = await admin
      .from("defect_catalogue_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row || row.company_id !== companyId) {
      return NextResponse.json({ error: "Item not found." }, { status: 404 });
    }

    const update: Record<string, unknown> = {};

    if (body.severity !== undefined) {
      if (!SEVERITIES.includes(body.severity as Severity)) {
        throw new ApiError(400, "Severity must be minor or dangerous.");
      }
      update.severity = body.severity;
    }

    if (body.guidance !== undefined) {
      const guidance = typeof body.guidance === "string" ? body.guidance.trim() : "";
      if (guidance.length > 400) {
        throw new ApiError(400, "Guidance must be 400 characters or fewer.");
      }
      update.guidance = guidance;
    }

    if (body.retired !== undefined) {
      update.retired_at = body.retired === true ? new Date().toISOString() : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ item: toCatalogueItem(row as Record<string, unknown>) });
    }

    const { data: updated, error: updateError } = await admin
      .from("defect_catalogue_items")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ item: toCatalogueItem(updated as Record<string, unknown>) });
  } catch (error) {
    return handleError(error);
  }
}
