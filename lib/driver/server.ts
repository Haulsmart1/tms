import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "../supabase/admin";

export type DriverPortalType =
  | "direct_driver"
  | "subcontractor_driver";

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

export async function requireDriverSession(): Promise<DriverSession> {
  const client = await createAuthenticatedClient();

  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    throw new DriverAccessError(
      "You must be signed in.",
      401,
    );
  }

  const admin = createAdminClient();

  const {
    data: direct,
    error: directError,
  } = await admin
    .from("driver_users")
    .select("tenant_id,driver_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (directError) {
    throw new Error(directError.message);
  }

  if (direct) {
    return {
      userId: user.id,
      tenantId: direct.tenant_id as string,
      driverId: direct.driver_id as string,
      subcontractorId: null,
      portalType: "direct_driver",
    };
  }

  const {
    data: portalUser,
    error: portalError,
  } = await admin
    .from("subcontractor_users")
    .select(
      "tenant_id,subcontractor_id,employee_id",
    )
    .eq("user_id", user.id)
    .eq("role", "driver")
    .eq("active", true)
    .maybeSingle();

  if (portalError) {
    throw new Error(portalError.message);
  }

  if (!portalUser) {
    throw new DriverAccessError(
      "No active driver portal access was found.",
      403,
    );
  }

  const {
    data: link,
    error: linkError,
  } = await admin
    .from("subcontractor_drivers")
    .select("driver_id")
    .eq("tenant_id", portalUser.tenant_id)
    .eq(
      "subcontractor_id",
      portalUser.subcontractor_id,
    )
    .eq("employee_id", portalUser.employee_id)
    .eq("active", true)
    .maybeSingle();

  if (linkError) {
    throw new Error(linkError.message);
  }

  if (!link?.driver_id) {
    throw new DriverAccessError(
      "Subcontractor employee is not linked to a driver record yet.",
      409,
    );
  }

  return {
    userId: user.id,
    tenantId: portalUser.tenant_id as string,
    driverId: link.driver_id as string,
    subcontractorId:
      portalUser.subcontractor_id as string,
    portalType: "subcontractor_driver",
  };
}

export function driverErrorResponse(error: unknown) {
  if (error instanceof DriverAccessError) {
    return {
      status: error.status,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Unable to process driver request.",
  };
}