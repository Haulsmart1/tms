import { NextResponse } from "next/server";
import { generatePodPdf } from "../../../../../../lib/pod/generatePdf";
import { resolvePodShareToken } from "../../../../../../lib/pod/shareStore";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../../../../lib/rateLimit";
import { createAdminClient } from "../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Public, token-gated POD PDF (review POD-9, POD-25).
  Rate limited per IP, because each hit downloads every photo and builds a PDF.
  Every refusal reads the same, and errors never echo internal detail.
*/
const INVALID_LINK = "This POD link is invalid, has expired or has been withdrawn.";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const admin = createAdminClient();

  const limit = await checkRateLimit(admin, RATE_LIMITS.podSharePdfPerIp, clientIp(request.headers));

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const { token } = await context.params;

  let rawToken: string;

  try {
    rawToken = decodeURIComponent(token);
  } catch {
    return NextResponse.json({ error: INVALID_LINK }, { status: 404 });
  }

  try {
    const share = await resolvePodShareToken(admin, rawToken);

    if (!share) {
      return NextResponse.json({ error: INVALID_LINK }, { status: 404 });
    }

    const { bytes, filename } = await generatePodPdf(share.tenantId, share.jobId);

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[pod-share-pdf] unable to generate POD PDF", error);

    return NextResponse.json(
      { error: "Unable to generate the POD PDF. Try again later." },
      { status: 500 },
    );
  }
}
