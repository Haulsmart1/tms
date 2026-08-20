import { NextResponse } from "next/server";
import { verifyPodShareToken } from "../../../../../../lib/pod/shareToken";
import { generatePodPdf } from "../../../../../../lib/pod/generatePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      token: string;
    }>;
  }
) {
  const { token } =
    await context.params;

  const payload =
    verifyPodShareToken(
      decodeURIComponent(token)
    );

  if (!payload) {
    return NextResponse.json(
      {
        error:
          "This POD share link is invalid or has expired.",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const {
      bytes,
      filename,
    } =
      await generatePodPdf(
        payload.tenantId,
        payload.jobId
      );

    return new Response(
      Buffer.from(bytes),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/pdf",
          "Content-Disposition":
            `inline; filename="${filename}"`,
          "Cache-Control":
            "private, no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate POD PDF.",
      },
      {
        status: 500,
      }
    );
  }
}
