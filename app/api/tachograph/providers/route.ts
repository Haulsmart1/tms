import { NextResponse } from "next/server";
import {
  authClient,
  requireOperator,
} from "../../../../lib/tomtom/server";
import {
  listTachographProviders,
} from "../../../../lib/tachograph/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = await authClient();
    const operator = await requireOperator(client);

    if (!operator) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    if (!operator.companyId) {
      return NextResponse.json(
        { error: "You do not have console access." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      providers: listTachographProviders(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to list tachograph providers.",
      },
      { status: 500 }
    );
  }
}
