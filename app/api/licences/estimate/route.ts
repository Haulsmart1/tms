// What adding a vehicle would cost, for the UI to show BEFORE the click.
//
// READ ONLY. This route opens no period, charges nothing and writes nothing.
// It exists so /settings/licences can answer "what will this cost me" without
// the customer having to find out by committing, which under period billing is
// a question with a genuinely surprising answer: an extra vehicle is free
// while the fleet is under the GBP 129 minimum, and free again at the fleet
// sizes where the volume-discount cap is carrying the price.
//
// GET rather than POST deliberately: nothing about it is a command, and a
// request that cannot change state should not look like one.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import { requireCompanyAdmin } from "../../../../lib/billing/server";
import { quoteVehicleAddition } from "../../../../lib/billing/periodServer";
import { londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VehicleId = z.string().uuid();

export async function GET(request: NextRequest) {
  try {
    const parsed = VehicleId.safeParse(
      request.nextUrl.searchParams.get("vehicleId")
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A vehicleId query parameter is required." },
        { status: 400 }
      );
    }

    const { admin, companyId } = await requireCompanyAdmin();

    // Ownership is checked even though this only reads. The quote reveals the
    // shape of a company's fleet (how far it is from a discount threshold, and
    // whether it is under its minimum), which is not something an admin of
    // another company should be able to probe one vehicle id at a time.
    const tenantsRes = await admin
      .from("tenants")
      .select("id")
      .eq("company_id", companyId);
    if (tenantsRes.error) throw new Error(tenantsRes.error.message);

    const scopeIds = [
      ...(tenantsRes.data ?? []).map((t) => t.id as string),
      companyId,
    ];

    const vehicleRes = await admin
      .from("vehicles")
      .select("id, tenant_id")
      .eq("id", parsed.data)
      .maybeSingle();
    if (vehicleRes.error) throw new Error(vehicleRes.error.message);

    if (
      !vehicleRes.data ||
      !scopeIds.includes(vehicleRes.data.tenant_id as string)
    ) {
      return NextResponse.json(
        { error: "That vehicle does not belong to your company." },
        { status: 403 }
      );
    }

    const quote = await quoteVehicleAddition(
      admin,
      companyId,
      parsed.data,
      londonDateISO(new Date())
    );

    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    // Same shape as the activate route. errorResponse maps requireCompanyAdmin's
    // UNAUTHENTICATED and FORBIDDEN throws and passes everything else through
    // verbatim, and the throws reachable from here name internals (the company
    // id, the 1000-row cap), so a 500 is logged in full and answered generically.
    const mapped = errorResponse(error);
    if (mapped.status === 500) {
      console.error(
        "Licence estimate failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
