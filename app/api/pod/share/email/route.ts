import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  createServerClient,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { sendLoggedDocumentEmail } from "../../../../../lib/documents/delivery";
import {
  buildDocumentEmailHtml,
} from "../../../../../lib/documents/emailTemplate";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { createPodShareToken } from "../../../../../lib/pod/shareToken";
import { generatePodPdf } from "../../../../../lib/pod/generatePdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authenticatedClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "Supabase public environment variables are missing."
    );
  }

  const store = await cookies();

  return createServerClient(
    url,
    anon,
    {
      cookies: {
        getAll: () => store.getAll(),

        setAll(items) {
          try {
            items.forEach(
              ({
                name,
                value,
                options,
              }) =>
                store.set(
                  name,
                  value,
                  options
                )
            );
          } catch {
            // A read-only cookie store is valid in some server contexts.
          }
        },
      },
    }
  );
}

async function userHasTenantAccess(
  userId: string,
  tenantId: string
): Promise<boolean> {
  const admin = createAdminClient();

  const {
    data: profile,
    error: profileError,
  } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(
      profileError.message
    );
  }

  if (profile?.tenant_id === tenantId) {
    return true;
  }

  const {
    data: membership,
    error: membershipError,
  } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(
      membershipError.message
    );
  }

  return Boolean(membership);
}

function safeHeader(
  value: string
): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as {
        jobId?: string;
        tenantId?: string;
        to?: string;
        useCustomerContact?: boolean;
      };

    const jobId =
      body.jobId?.trim();

    const tenantId =
      body.tenantId?.trim();

    if (!jobId || !tenantId) {
      return NextResponse.json(
        {
          error:
            "jobId and tenantId are required.",
        },
        {
          status: 400,
        }
      );
    }

    const userClient =
      await authenticatedClient();

    const {
      data: { user },
      error: userError,
    } =
      await userClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error:
            "You must be signed in.",
        },
        {
          status: 401,
        }
      );
    }

    if (
      !(await userHasTenantAccess(
        user.id,
        tenantId
      ))
    ) {
      return NextResponse.json(
        {
          error:
            "You do not have access to this tenant.",
        },
        {
          status: 403,
        }
      );
    }

    const admin =
      createAdminClient();

    const {
      data: job,
      error: jobError,
    } = await admin
      .from("jobs")
      .select(`
        id,
        reference,
        status,
        customer_id,
        external_reference
      `)
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (jobError) {
      throw new Error(
        jobError.message
      );
    }

    if (!job) {
      return NextResponse.json(
        {
          error: "Job not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (job.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "The job must be completed before POD can be emailed.",
        },
        {
          status: 409,
        }
      );
    }

    let customer:
      | {
          name: string | null;
          contact_name: string | null;
          email: string | null;
          operations_email: string | null;
        }
      | null = null;

    if (job.customer_id) {
      const {
        data,
        error,
      } = await admin
        .from("customers")
        .select(`
          name,
          contact_name,
          email,
          operations_email
        `)
        .eq("id", job.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) {
        throw new Error(
          error.message
        );
      }

      customer = data;
    }

    const isCambridge =
      Boolean(
        job.external_reference?.startsWith(
          "CAMBRIDGE-RMA-"
        )
      );

    if (
      body.useCustomerContact &&
      !isCambridge
    ) {
      return NextResponse.json(
        {
          error:
            "Ping Cambridge is only available for Cambridge RMA jobs.",
        },
        {
          status: 409,
        }
      );
    }

    const recipient =
      body.useCustomerContact
        ? (
            customer?.operations_email ??
            customer?.email ??
            ""
          ).trim()
        : (
            body.to ?? ""
          ).trim();

    if (
      !recipient ||
      !EMAIL_PATTERN.test(recipient)
    ) {
      return NextResponse.json(
        {
          error:
            "A valid POD email recipient is required.",
        },
        {
          status: 400,
        }
      );
    }


    const token =
      createPodShareToken(
        jobId,
        tenantId
      );

    const origin =
      new URL(request.url).origin;

    const shareUrl =
      `${origin}/pod/share/${encodeURIComponent(
        token
      )}`;

    const {
      bytes,
      filename,
      pod,
    } =
      await generatePodPdf(
        tenantId,
        jobId
      );

    const reference =
      safeHeader(
        pod.reference ||
          job.reference ||
          "POD"
      );

    const contactName =
      customer?.contact_name ??
      customer?.name ??
      "Customer";

    const subject =
      isCambridge
        ? `POD - Cambridge Audio RMA ${reference}`
        : `Proof of Delivery - ${reference}`;

    const text = [
      `Hi ${contactName},`,
      "",
      `Proof of Delivery is now available for ${reference}.`,
      "",
      "The delivery has been completed.",
      "",
      `Secure POD link: ${shareUrl}`,
      "",
      "A PDF copy of the POD is attached to this email.",
      "",
      "Regards,",
      "ADR Carriers",
    ].join("\n");
    const html =
      buildDocumentEmailHtml({
        companyName:
          "ADR Carriers ltd",
        recipientName:
          contactName,
        title:
          `Proof of Delivery - ${reference}`,
        intro:
          "Your proof of delivery is ready.",
        summaryRows: [
          {
            label:
              "Job reference",
            value:
              reference,
          },
          {
            label:
              "Status",
            value:
              "Delivered",
          },
        ],
        attachmentText:
          "A PDF copy of the Proof of Delivery is attached.",
        actionLabel:
          "View Proof of Delivery",
        actionUrl:
          shareUrl,
        footerText:
          "Thank you for choosing ADR Carriers.",
      });
    const delivery =
      await sendLoggedDocumentEmail({
        admin,
        tenantId,
        documentType:
          "pod",
        documentId:
          job.id,
        recipient,
        subject,
        text,
        html,
        shareReference:
          shareUrl,
        initiatedBy:
          user.id,
        attachments: [
          {
            filename,
            content:
              Buffer.from(bytes),
            contentType:
              "application/pdf",
          },
        ],
        metadata: {
          jobId:
            job.id,
          reference,
          customerName:
            contactName,
        },
      });


    return NextResponse.json({
      ok: true,
      id:
        delivery.providerMessageId,

      deliveryLogId:
        delivery.deliveryLogId,
      recipient,
      shareUrl,
    });
  } catch (error) {
    console.error(
      "Unable to email POD:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to email POD.",
      },
      {
        status: 500,
      }
    );
  }
}
