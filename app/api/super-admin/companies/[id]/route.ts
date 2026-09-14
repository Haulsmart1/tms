import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { normalizeCompanyEdit } from "../../../../../lib/superAdmin/companyEdit";
import { recordSuperAdminAudit } from "../../../../../lib/superAdmin/audit";
import { isUuid } from "../../../../../lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Writes companies.name and the company_profiles row.

   This holds the service-role key because it has to: rls_04 gives companies a
   select policy and no write policy at all, with the comment "service role
   provisions". That is a boundary to respect, not a gap to patch with a new
   client-facing policy.

   Everything that reaches .update() comes from normalizeCompanyEdit, which
   rebuilds the patch from an allowlist. Do not add a field to the update call
   without adding it there.

   Both writes are idempotent: .update() sends a fixed payload keyed on id, and
   .upsert() with onConflict resolves to the same row every time. That is what
   makes it safe to tell an operator to retry after a partial failure below --
   a future refactor that swapped the upsert for a plain insert would break
   that safety without changing anything else about this route's shape. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: companyId } = await context.params;

    // The raw URL segment goes straight into .eq("id", ...) against a uuid
    // column. An id shaped wrong for that column (not merely absent) is a
    // client mistake, not a lookup failure: without this check it reaches
    // Postgres as 22P02 and comes back through the lookupError branch below,
    // reported to the client as a 500 with a log line that misdescribes what
    // happened.
    if (!isUuid(companyId)) {
      return NextResponse.json({ error: "No such company." }, { status: 404 });
    }

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
      // Load-bearing, not just a nicer 404: without this lookup, a PATCH to a
      // nonexistent id would have the companies.update() below match zero
      // rows and return NO error (PostgREST does not treat a zero-row match
      // as a failure), fall through to the upsert, insert a company_profiles
      // row keyed to a company that does not exist, and report 200 {ok:true}
      // -- an orphan row behind an apparent success.
      return NextResponse.json({ error: "No such company." }, { status: 404 });
    }

    /* company_profiles.tenant_id holds the COMPANY id despite its name
       (rls_04_identity_tables.sql:27). onConflict names it explicitly so an
       upsert for a company with no profile row inserts rather than erroring.

       This write goes FIRST, ahead of the one-column companies.name update
       that follows, because it is the one more likely to fail: a 28-column
       insert-or-update against a table whose unique index and constraints
       this route cannot see, versus a single column against a row whose
       existence was just proven above. Partial state can only happen when
       the first write lands and the second fails, so ordering the riskier
       write first turns most failures into a clean, fully-retryable no-op
       instead of a partial write. */
    const { error: profileError } = await admin
      .from("company_profiles")
      .upsert({ ...normalized.profile, tenant_id: companyId }, { onConflict: "tenant_id" });

    if (profileError) {
      // Nothing has been written yet, so this is a clean failure, not a
      // partial one -- there is nothing to audit as landed.
      console.error("super-admin company update: profile write failed", profileError);
      return NextResponse.json({ error: "Unable to update this company." }, { status: 500 });
    }

    const { error: nameError } = await admin
      .from("companies")
      .update({ name: normalized.name })
      .eq("id", companyId);

    if (nameError) {
      /* The profile write already landed, and it includes the new name:
         normalizeCompanyEdit always sets profile.company_name = name (see
         its own comment on why), and that field is not stripped out or
         written separately -- it goes into the SAME upsert as every other
         profile column above. So when only this second write fails, the new
         name is NOT missing; it is already stored, in company_profiles, just
         not yet in companies.name too. The old message ("could not be
         updated") was wrong: the name WAS updated, in one of the two places
         it lives, and the operator's own "cannot drift apart" hint is
         temporarily untrue until a retry reconciles the two.

         This is FIX 2's chosen shape (option a from the review): leave
         company_name inside the profile patch rather than reordering the
         two writes back to name-first. Reverting to name-first would turn
         most failures into partial writes again, because the profile upsert
         (28 columns, a table with an unverified unique index and possible
         constraints this route cannot see) is the one more likely to fail --
         moving it second would put it back in the failure path most often.
         The one-column companies.update() failing on its own, after the
         28-column upsert already succeeded, should be comparatively rare;
         when it does happen, correcting the message is cheaper and safer
         than trading back the ordering's own benefit.

         LOG it regardless: a write that really happened must not go
         unaudited just because the request as a whole failed. changedFields
         names what landed (the profile columns, company_name included), not
         "name" -- the companies.update() that failed. */
      console.error("super-admin company update: name write failed", nameError);

      logSuperAdminEdit({
        actorId,
        action: "company.update",
        targetId: companyId,
        changedFields: Object.keys(normalized.profile),
        result: "partial",
      });

      await recordSuperAdminAudit(admin, {
        actorId,
        action: "company.update",
        targetType: "company",
        targetId: companyId,
        changedFields: Object.keys(normalized.profile),
        result: "partial",
      });

      return NextResponse.json(
        {
          error:
            "The company profile, including the new name, was saved. The company record itself still shows the old name until you try again -- the two are temporarily out of step.",
          partial: true,
        },
        { status: 500 },
      );
    }

    // changedFields always includes "name" here (the companies.name column)
    // alongside the profile keys, so a full success and a partial failure
    // agree on what "name" means in this log -- the partial branch above
    // logs only the profile keys because that is genuinely all that landed
    // when the name write fails.
    //
    // Also: this records fields PRESENT IN THE REQUEST, not fields whose
    // values actually changed. The settings form posts every field on every
    // save, so in practice this list is the same on every call regardless of
    // what the operator actually edited. Fine for a breadcrumb, but the name
    // "changedFields" reads as a stronger claim than that.
    logSuperAdminEdit({
      actorId,
      action: "company.update",
      targetId: companyId,
      changedFields: ["name", ...Object.keys(normalized.profile)],
      result: "ok",
    });

    // Durable copy of the breadcrumb above (AUTH-15). Best effort: the edit
    // has already landed, so a missing audit table must not fail it.
    await recordSuperAdminAudit(admin, {
      actorId,
      action: "company.update",
      targetType: "company",
      targetId: companyId,
      changedFields: ["name", ...Object.keys(normalized.profile)],
      result: "ok",
    });

    return NextResponse.json({ ok: true });
  },
);
