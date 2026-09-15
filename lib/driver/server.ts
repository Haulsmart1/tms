import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "../supabase/admin";
import {
  selectDriverLink,
  type DriverLink,
  type DriverLinkTarget,
  type DriverPortalType,
} from "./session";

export type { DriverPortalType } from "./session";

export type DriverSession = {
  userId: string;
  tenantId: string;
  driverId: string;
  subcontractorId: string | null;
  portalType: DriverPortalType;
};

export class DriverAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DriverAccessError";
  }
}

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing Supabase public environment variables.");
  }

  const store = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => {
            store.set(name, value, options);
          });
        } catch {
          // Some server contexts expose a read-only cookie store.
        }
      },
    },
  });
}

/**
  Resolve the signed-in driver. Pass `jobId` on routes about one job: when the
  user holds several active driver links (review POD-22), the link that owns
  that job is used. Without a job, several distinct links answer a clear 409
  instead of a 500 or a guessed tenant.
*/
export async function requireDriverSession(
  options: { jobId?: string } = {},
): Promise<DriverSession> {
  const client = await createAuthenticatedClient();

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    throw new DriverAccessError("You must be signed in.", 401);
  }

  const admin = createAdminClient();

  const [directResult, portalResult] = await Promise.all([
    admin
      .from("driver_users")
      .select("tenant_id,driver_id")
      .eq("user_id", user.id)
      .eq("active", true),
    admin
      .from("subcontractor_users")
      .select("tenant_id,subcontractor_id,employee_id")
      .eq("user_id", user.id)
      .eq("role", "driver")
      .eq("active", true),
  ]);

  if (directResult.error) throw new Error(directResult.error.message);
  if (portalResult.error) throw new Error(portalResult.error.message);

  const links: DriverLink[] = (directResult.data ?? [])
    .filter((row) => row.tenant_id && row.driver_id)
    .map((row) => ({
      tenantId: String(row.tenant_id),
      driverId: String(row.driver_id),
      subcontractorId: null,
      portalType: "direct_driver" as const,
    }));

  const portalUsers = portalResult.data ?? [];

  const portalLinks = await Promise.all(
    portalUsers.map(async (portalUser) => {
      const { data, error } = await admin
        .from("subcontractor_drivers")
        .select("driver_id")
        .eq("tenant_id", portalUser.tenant_id)
        .eq("subcontractor_id", portalUser.subcontractor_id)
        .eq("employee_id", portalUser.employee_id)
        .eq("active", true);

      if (error) throw new Error(error.message);

      return (data ?? [])
        .filter((row) => row.driver_id)
        .map((row) => ({
          tenantId: String(portalUser.tenant_id),
          driverId: String(row.driver_id),
          subcontractorId: String(portalUser.subcontractor_id),
          portalType: "subcontractor_driver" as const,
        }));
    }),
  );

  links.push(...portalLinks.flat());

  if (links.length === 0) {
    if (portalUsers.length > 0) {
      throw new DriverAccessError(
        "Subcontractor employee is not linked to a driver record yet.",
        409,
      );
    }

    throw new DriverAccessError(
      "No active driver portal access was found.",
      403,
    );
  }

  let target: DriverLinkTarget | null = null;

  if (options.jobId && links.length > 1) {
    const { data: job, error: jobError } = await admin
      .from("jobs")
      .select("tenant_id,driver_id,subcontractor_id")
      .eq("id", options.jobId)
      .maybeSingle();

    if (jobError) throw new Error(jobError.message);

    if (job) {
      target = {
        tenantId: String(job.tenant_id),
        driverId: job.driver_id ? String(job.driver_id) : null,
        subcontractorId: job.subcontractor_id ? String(job.subcontractor_id) : null,
      };
    }
  }

  const selection = selectDriverLink(links, target);

  if (!selection.ok) {
    throw new DriverAccessError(
      selection.reason === "ambiguous"
        ? "Your login is linked to more than one driver record. Ask your operator to remove the extra driver access."
        : "No active driver portal access was found.",
      selection.reason === "ambiguous" ? 409 : 403,
    );
  }

  return {
    userId: user.id,
    tenantId: selection.link.tenantId,
    driverId: selection.link.driverId,
    subcontractorId: selection.link.subcontractorId,
    portalType: selection.link.portalType,
  };
}

export function driverErrorResponse(error: unknown) {
  if (error instanceof DriverAccessError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  console.error("[driver] request failed", error);

  return {
    status: 500,
    message: "Unable to process driver request.",
  };
}
