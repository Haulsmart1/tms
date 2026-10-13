// Restore one archived asset. Office callers only (drivers refused). See lib/assets/server.ts.

import { NextRequest, NextResponse } from "next/server";
import { setAssetArchived } from "../../../../../lib/assets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await setAssetArchived(id, false);
  return NextResponse.json(result.body, { status: result.status });
}
