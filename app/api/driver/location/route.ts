import { NextRequest, NextResponse } from "next/server";

import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../lib/driver/server";
import { parseDriverLocation } from "../../../../lib/driver/location";
import { checkRateLimit, RATE_LIMITS } from "../../../../lib/rateLimit";
import { createAdminClient } from "../../../../lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const session = await requireDriverSession();
    const raw: unknown = await request.json();
    const ownerId = raw && typeof raw === "object" ? (raw as Record<string, unknown>).ownerId : undefined;
    // The phone may have captured this point before another driver signed in.
    // Never turn a late A-owned (or unbound legacy) fix into B's vehicle data.
    if (typeof ownerId !== "string" || ownerId !== session.userId) {
      return NextResponse.json(
        { error: "This GPS position belongs to another or unknown sign-in. Keep this page open and tell the office." },
        { status: 409 },
      );
    }
    const admin = createAdminClient();
    const limit = await checkRateLimit(admin, RATE_LIMITS.driverLocation, session.userId);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many location updates. Try again shortly." }, { status: 429 });
    }
    const location = parseDriverLocation(raw);

    const { data: assignments, error: assignmentError } =
      await admin
        .from("vehicle_assignments")
        .select("id,vehicle_id")
        .eq("tenant_id", session.tenantId)
        .eq("driver_id", session.driverId)
        .eq("active", true);

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json(
        { error: "No active vehicle is assigned to this driver." },
        { status: 409 },
      );
    }

    if (assignments.length !== 1) {
      return NextResponse.json(
        {
          error:
            "Multiple active vehicles are assigned. GPS tracking cannot determine the correct vehicle.",
        },
        { status: 409 },
      );
    }

    const vehicleId = assignments[0].vehicle_id;

    if (!vehicleId) {
      return NextResponse.json(
        { error: "The active vehicle assignment is invalid." },
        { status: 409 },
      );
    }

    const { error: insertError } = await admin
      .from("telematics_positions")
      .insert({
        tenant_id: session.tenantId,
        vehicle_id: vehicleId,
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speedKph,
        heading: location.heading,
        recorded_at: location.recordedAt,
      });

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      ok: true,
      recordedAt: location.recordedAt,
    });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        error.message.startsWith("Invalid GPS"))
    ) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid GPS location.",
        },
        { status: 400 },
      );
    }

    if (
      error instanceof Error &&
      (error.message === "GPS timestamp is in the future." ||
        error.message === "GPS timestamp is too old.")
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    console.error("[driver/location] GPS request failed", {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    const response = driverErrorResponse(error);

    return NextResponse.json(
      { error: response.message },
      { status: response.status },
    );
  }
}
