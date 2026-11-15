import { NextResponse } from "next/server";
import { withSuperAdmin } from "../../../../../lib/superAdmin/guard";

export const PATCH = withSuperAdmin(async () =>
  NextResponse.json(
    { error: "Open the tenant workspace and use Accounts to update a customer invoice." },
    { status: 410 },
  ),
);
