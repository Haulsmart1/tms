// Permanently delete one asset. Admins only; refused while it has maintenance
// history (archive it instead). Rules and contract: lib/assets/server.ts and
// lib/assets/deleteRule.ts.

import { NextRequest, NextResponse } from "next/server";
import { deleteAsset } from "../../../../lib/assets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await deleteAsset(id);
  return NextResponse.json(result.body, { status: result.status });
}
