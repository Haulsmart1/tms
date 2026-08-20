import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  createServerClient,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { createPodShareToken } from "../../../../lib/pod/shareToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
            // Read-only cookie stores are valid in some server contexts.
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
    throw new Error(profileError.message);
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

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      (await request.json()) as {
        jobId?: string;
        tenantId?: string;
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

    const admin = createAdminClient();

    const {
      data: job,
      error: jobError,
    } = await admin
      .from("jobs")
      .select(`
        id,
        status,
        reference,
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
            "POD sharing is available after the job is completed.",
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
          phone: string | null;
          mobile: string | null;
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
          operations_email,
          phone,
          mobile
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

    const token =
      createPodShareToken(
        jobId,
        tenantId
      );

    const origin =
      new URL(request.url).origin;

    const encodedToken =
      encodeURIComponent(token);

    const shareUrl =
      `${origin}/pod/share/${encodedToken}`;

    const pdfUrl =
      `${origin}/api/pod/share/${encodedToken}/pdf`;

    const isCambridge =
      Boolean(
        job.external_reference?.startsWith(
          "CAMBRIDGE-RMA-"
        )
      );

    return NextResponse.json({
      ok: true,
      shareUrl,
      pdfUrl,
      expiresInSeconds:
        7 * 24 * 60 * 60,

      reference:
        job.reference ?? null,

      isCambridge,

      contactName:
        customer?.contact_name ??
        customer?.name ??
        null,

      contactEmail:
        customer?.operations_email ??
        customer?.email ??
        null,

      contactPhone:
        customer?.mobile ??
        customer?.phone ??
        null,
    });
  } catch (error) {
    console.error(
      "Unable to create POD share:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create POD share.",
      },
      {
        status: 500,
      }
    );
  }
}
