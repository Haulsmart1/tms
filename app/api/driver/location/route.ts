import { NextRequest, NextResponse } from "next/server";

import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../lib/driver/server";
import { parseDriverLocation } from "../../../../lib/driver/location";
import { createAdminClient } from "../../../../lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const session = await requireDriverSession();
    const location = parseDriverLocation(await request.json());
    const admin = createAdminClient();

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
