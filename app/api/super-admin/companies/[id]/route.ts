import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { normalizeCompanyEdit } from "../../../../../lib/superAdmin/companyEdit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Writes companies.name and the company_profiles row.

   This holds the service-role key because it has to: rls_04 gives companies a
   select policy and no write policy at all, with the comment "service role
   provisions". That is a boundary to respect, not a gap to patch with a new
   client-facing policy.

   Everything that reaches .update() comes from normalizeCompanyEdit, which
   rebuilds the patch from an allowlist. Do not add a field to the update call
   without adding it there. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: companyId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const normalized = normalizeCompanyEdit(body);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error, field: normalized.field }, { status: 400 });
    }

    // createAdminClient() throws when SUPABASE_SERVICE_ROLE_KEY is missing.
    // Left uncaught, Next's boundary turns that into its own HTML error page
    // instead of JSON, which breaks the one-shape-of-error contract this
    // route otherwise holds (app/api/request-access/route.ts:107-117 is the
    // precedent for this guard).
    let admin;
    try {
      admin = createAdminClient();
    } catch (err) {
      console.error("super-admin company update: Supabase admin client unavailable", err);
      return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
    }

    const { data: existing, error: lookupError } = await admin
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();

    if (lookupError) {
      // Supabase error text names tables/columns; never hand that to the
      // client. Log the real error server-side and return a fixed string.
      console.error("super-admin company update: lookup failed", lookupError);
      return NextResponse.json({ error: "Unable to update this company." }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "No such company." }, { status: 404 });
    }

    const { error: nameError } = await admin
      .from("companies")
      .update({ name: normalized.name })
      .eq("id", companyId);

    if (nameError) {
      console.error("super-admin company update: name write failed", nameError);
      return NextResponse.json({ error: "Unable to update this company." }, { status: 500 });
    }

    /* company_profiles.tenant_id holds the COMPANY id despite its name
       (rls_04_identity_tables.sql:27). onConflict names it explicitly so an
       upsert for a company with no profile row inserts rather than erroring. */
    const { error: profileError } = await admin
      .from("company_profiles")
      .upsert({ ...normalized.profile, tenant_id: companyId }, { onConflict: "tenant_id" });

    if (profileError) {
      /* The name write already landed. Say so, rather than reporting a clean
         failure the operator would reasonably retry from stale form state, and
         LOG it: a write that really happened must not go unaudited just because
         the request as a whole failed. */
      console.error("super-admin company update: profile write failed", profileError);

      logSuperAdminEdit({
        actorId,
        action: "company.update",
        targetId: companyId,
        changedFields: ["name"],
        result: "partial",
      });

      return NextResponse.json(
        { error: "The company name was saved, but the company details could not be. Please try again.", partial: true },
        { status: 500 },
      );
    }

    logSuperAdminEdit({
      actorId,
      action: "company.update",
      targetId: companyId,
      changedFields: Object.keys(normalized.profile),
      result: "ok",
    });

    return NextResponse.json({ ok: true });
  },
);
