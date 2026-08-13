import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADR_CARRIERS_TENANT_ID =
  "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

const CAMBRIDGE_AUDIO_CUSTOMER_ID =
  "c4dec984-c84b-456d-a269-ac9d7626a2f7";

const CAMBRIDGE_INTEGRATION = "cambridge_audio_rma";

const AddressSchema = z.object({
  address_line1: z.string().trim().min(1),
  address_line2: z.string().trim().optional().nullable(),
  address_line3: z.string().trim().optional().nullable(),
  locality: z.string().trim().min(1),
  postal_code: z.string().trim().min(1),
});

const ItemSchema = z.object({
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  serial: z.array(z.string().trim().min(1)).optional().default([]),
});

const RmaSchema = z.object({
  id: z.coerce.number().int().positive(),
  number: z.string().trim().min(1),
  first_name: z.string().trim().optional().nullable(),
  last_name: z.string().trim().optional().nullable(),
  collection_address: z.array(AddressSchema).optional().default([]),
  delivery_address: z.array(AddressSchema).optional().default([]),
  telephone: z.array(z.string().trim()).optional().default([]),
  email: z.string().trim().email().optional().nullable(),
  items: z.array(ItemSchema).optional().default([]),
});

type RmaPayload = z.infer<typeof RmaSchema>;
type Address = z.infer<typeof AddressSchema>;

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authenticateCambridge(request: NextRequest): boolean {
  const expectedSecret = process.env.CAMBRIDGE_RMA_SECRET;

  if (!expectedSecret) {
    throw new Error("CAMBRIDGE_RMA_SECRET is not configured.");
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedSecret = authorization.slice("Bearer ".length).trim();

  if (!suppliedSecret) {
    return false;
  }

  return secureStringEquals(suppliedSecret, expectedSecret);
}

function combineName(rma: RmaPayload): string | null {
  const fullName = [rma.first_name, rma.last_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();

  return fullName || null;
}

function formatAddress(address: Address): string {
  return [
    address.address_line1,
    address.address_line2,
    address.address_line3,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
}

function buildJobNotes(rma: RmaPayload): string {
  const contactName = combineName(rma);

  const details = [
    "Cambridge Audio RMA",
    `RMA Number: ${rma.number}`,
    `RMA ID: ${rma.id}`,
    contactName ? `Customer: ${contactName}` : null,
    rma.telephone.length
      ? `Telephone: ${rma.telephone.join(", ")}`
      : null,
    rma.email ? `Email: ${rma.email}` : null,
    rma.items.length
      ? `Items: ${rma.items
          .map((item) => `${item.quantity} x ${item.name} (${item.sku})`)
          .join("; ")}`
      : null,
  ].filter(Boolean);

  return details.join("\n");
}

async function createImportRecord(
  supabase: SupabaseAdmin,
  rma: RmaPayload,
  rawPayload: unknown
) {
  const { data, error } = await supabase
    .from("cambridge_rma_imports")
    .insert({
      tenant_id: ADR_CARRIERS_TENANT_ID,
      customer_id: CAMBRIDGE_AUDIO_CUSTOMER_ID,
      rma_id: rma.id,
      rma_number: rma.number,
      status: "received",
      raw_payload: rawPayload,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new DuplicateRmaError(
        `Cambridge RMA ${rma.number} (${rma.id}) has already been received.`
      );
    }

    throw new Error(`Unable to create RMA audit record: ${error.message}`);
  }

  return data.id as string;
}

async function createJob(
  supabase: SupabaseAdmin,
  rma: RmaPayload
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      tenant_id: ADR_CARRIERS_TENANT_ID,
      customer_id: CAMBRIDGE_AUDIO_CUSTOMER_ID,

      reference: rma.number,
      customer_reference: rma.number,
      external_reference: `CAMBRIDGE-RMA-${rma.id}`,

      status: "pending",
      priority: "normal",

      job_date: today,
      scheduled_date: today,

      notes: buildJobNotes(rma),
      internal_notes:
        `Automatically created by ${CAMBRIDGE_INTEGRATION}.`,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create TMS job: ${error.message}`);
  }

  return data.id as string;
}

async function createStops(
  supabase: SupabaseAdmin,
  jobId: string,
  rma: RmaPayload
) {
  const stops: Record<string, unknown>[] = [];

  const collection = rma.collection_address[0];

  if (collection) {
    stops.push({
      tenant_id: ADR_CARRIERS_TENANT_ID,
      job_id: jobId,
      stop_order: 1,
      type: "collection",
      address_line: formatAddress(collection),
      city: collection.locality,
      postcode: collection.postal_code.toUpperCase(),
      status: "pending",
      recipient_name: combineName(rma),
    });
  }

  const delivery = rma.delivery_address[0];

  if (delivery) {
    stops.push({
      tenant_id: ADR_CARRIERS_TENANT_ID,
      job_id: jobId,
      stop_order: stops.length + 1,
      type: "delivery",
      address_line: formatAddress(delivery),
      city: delivery.locality,
      postcode: delivery.postal_code.toUpperCase(),
      status: "pending",
      recipient_name: combineName(rma),
    });
  }

  if (stops.length === 0) {
    return;
  }

  const { error } = await supabase.from("job_stops").insert(stops);

  if (error) {
    throw new Error(`Unable to create job stops: ${error.message}`);
  }
}

async function createItems(
  supabase: SupabaseAdmin,
  jobId: string,
  rma: RmaPayload
) {
  if (rma.items.length === 0) {
    return;
  }

  const items = rma.items.map((item) => ({
    tenant_id: ADR_CARRIERS_TENANT_ID,
    job_id: jobId,
    sku: item.sku,
    description: item.name,
    quantity: item.quantity,
    serial_numbers: item.serial,
    external_reference: rma.number,
  }));

  const { error } = await supabase.from("job_items").insert(items);

  if (error) {
    throw new Error(`Unable to create job items: ${error.message}`);
  }
}

async function markImportProcessed(
  supabase: SupabaseAdmin,
  importId: string,
  jobId: string
) {
  const { error } = await supabase
    .from("cambridge_rma_imports")
    .update({
      job_id: jobId,
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", importId)
    .eq("tenant_id", ADR_CARRIERS_TENANT_ID);

  if (error) {
    throw new Error(
      `Job was created but RMA audit update failed: ${error.message}`
    );
  }
}

async function markImportFailed(
  supabase: SupabaseAdmin,
  importId: string,
  errorMessage: string
) {
  await supabase
    .from("cambridge_rma_imports")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 4000),
      processed_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("tenant_id", ADR_CARRIERS_TENANT_ID);
}

async function rollbackJob(
  supabase: SupabaseAdmin,
  jobId: string | null
) {
  if (!jobId) {
    return;
  }

  /*
   * job_stops and job_items should cascade from jobs.
   * This compensating delete avoids leaving a partially imported RMA.
   */
  const { error } = await supabase
    .from("jobs")
    .delete()
    .eq("id", jobId)
    .eq("tenant_id", ADR_CARRIERS_TENANT_ID);

  if (error) {
    console.error(
      "Cambridge RMA rollback failed",
      jobId,
      error.message
    );
  }
}

class DuplicateRmaError extends Error {}

export async function POST(request: NextRequest) {
  let importId: string | null = null;
  let jobId: string | null = null;

  try {
    if (!authenticateCambridge(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized",
        },
        {
          status: 401,
        }
      );
    }

    const rawPayload: unknown = await request.json();

    const validationResult = RmaSchema.safeParse(rawPayload);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid Cambridge Audio RMA payload",
          validation_errors:
            validationResult.error.flatten(),
        },
        {
          status: 400,
        }
      );
    }

    const rma = validationResult.data;
    const supabase = createAdminClient();

    /*
     * Safety check: verify the hard-coded customer still belongs
     * to the hard-coded ADR Carriers tenant.
     */
    const { data: cambridgeCustomer, error: customerError } =
      await supabase
        .from("customers")
        .select("id, tenant_id, name, active")
        .eq("id", CAMBRIDGE_AUDIO_CUSTOMER_ID)
        .eq("tenant_id", ADR_CARRIERS_TENANT_ID)
        .maybeSingle();

    if (customerError) {
      throw new Error(
        `Unable to verify Cambridge Audio customer: ${customerError.message}`
      );
    }

    if (!cambridgeCustomer) {
      throw new Error(
        "Cambridge Audio is not configured for the ADR Carriers tenant."
      );
    }

    if (cambridgeCustomer.active === false) {
      return NextResponse.json(
        {
          ok: false,
          error: "Cambridge Audio customer account is inactive.",
        },
        {
          status: 409,
        }
      );
    }

    importId = await createImportRecord(
      supabase,
      rma,
      rawPayload
    );

    jobId = await createJob(supabase, rma);

    await createStops(supabase, jobId, rma);

    await createItems(supabase, jobId, rma);

    await markImportProcessed(
      supabase,
      importId,
      jobId
    );

    return NextResponse.json(
      {
        ok: true,
        integration: CAMBRIDGE_INTEGRATION,
        tenant_id: ADR_CARRIERS_TENANT_ID,
        customer_id: CAMBRIDGE_AUDIO_CUSTOMER_ID,
        cambridge_rma: {
          id: rma.id,
          number: rma.number,
        },
        job: {
          id: jobId,
          reference: rma.number,
        },
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    if (error instanceof DuplicateRmaError) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          error: error.message,
        },
        {
          status: 409,
        }
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unknown Cambridge RMA import error.";

    console.error("Cambridge Audio RMA import failed:", error);

    try {
      const supabase = createAdminClient();

      await rollbackJob(supabase, jobId);

      if (importId) {
        await markImportFailed(
          supabase,
          importId,
          message
        );
      }
    } catch (cleanupError) {
      console.error(
        "Cambridge RMA cleanup failed:",
        cleanupError
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}