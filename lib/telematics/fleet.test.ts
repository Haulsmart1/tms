import {
  describe,
  expect,
  it,
} from "vitest";
import type {
  PositionReading,
} from "../tracking/position";
import {
  buildFleetVehicleState,
  fleetMotionStatus,
  sortFleetVehicles,
  summarizeFleet,
  type FleetVehicle,
} from "./fleet";

const NOW =
  new Date("2026-09-14T12:00:00Z");

function reading(
  recordedAt: string,
  speedKph: number
): PositionReading {
  return {
    vehicleId: "v1",
    lat: 53.8,
    lng: -1.5,
    speedKph,
    headingDeg: 90,
    recordedAt,
  };
}

function vehicle(
  id: string,
  registration: string,
  position: PositionReading | null
): FleetVehicle {
  return {
    id,
    registration,
    make: "Ford",
    model: "Transit",
    driverId: null,
    driverName: null,
    reading: position,
  };
}

describe("fleetMotionStatus", () => {
  it("classifies movement", () => {
    expect(
      fleetMotionStatus(
        reading(
          "2026-09-14T11:59:00Z",
          37
        )
      )
    ).toBe("moving");
  });

  it("treats low-speed GPS jitter as stationary", () => {
    expect(
      fleetMotionStatus(
        reading(
          "2026-09-14T11:59:00Z",
          0.4
        )
      )
    ).toBe("stationary");
  });

  it("does not invent motion from invalid speed", () => {
    expect(
      fleetMotionStatus(
        reading(
          "2026-09-14T11:59:00Z",
          -5
        )
      )
    ).toBe("unknown");

    expect(
      fleetMotionStatus(null)
    ).toBe("unknown");
  });
});

describe("buildFleetVehicleState", () => {
  it("keeps signal and movement separate", () => {
    const result =
      buildFleetVehicleState(
        vehicle(
          "v1",
          "MX69UJZ",
          reading(
            "2026-09-14T11:59:00Z",
            42
          )
        ),
        NOW
      );

    expect(result.signalStatus).toBe("live");
    expect(result.motionStatus).toBe("moving");
  });

  it("marks old readings stale", () => {
    const result =
      buildFleetVehicleState(
        vehicle(
          "v1",
          "MX69UJZ",
          reading(
            "2026-09-14T11:30:00Z",
            0
          )
        ),
        NOW
      );

    expect(result.signalStatus).toBe("stale");
    expect(result.motionStatus).toBe("unknown");
  });

  it("marks missing readings no signal", () => {
    const result =
      buildFleetVehicleState(
        vehicle(
          "v1",
          "MX69UJZ",
          null
        ),
        NOW
      );

    expect(result.signalStatus).toBe("no_signal");
  });
});

describe("summarizeFleet", () => {
  it("summarizes without double counting", () => {
    const states = [
      buildFleetVehicleState(
        vehicle(
          "1",
          "A1",
          reading(
            "2026-09-14T11:59:00Z",
            35
          )
        ),
        NOW
      ),
      buildFleetVehicleState(
        vehicle(
          "2",
          "A2",
          reading(
            "2026-09-14T11:59:00Z",
            0
          )
        ),
        NOW
      ),
      buildFleetVehicleState(
        vehicle(
          "3",
          "A3",
          reading(
            "2026-09-14T11:30:00Z",
            80
          )
        ),
        NOW
      ),
      buildFleetVehicleState(
        vehicle(
          "4",
          "A4",
          null
        ),
        NOW
      ),
    ];

    expect(
      summarizeFleet(states)
    ).toEqual({
      total: 4,
      live: 2,
      moving: 1,
      stationary: 1,
      stale: 1,
      noSignal: 1,
    });
  });
});

describe("sortFleetVehicles", () => {
  it("puts live before stale and no signal", () => {
    const states = [
      buildFleetVehicleState(
        vehicle("3", "CCC", null),
        NOW
      ),
      buildFleetVehicleState(
        vehicle(
          "2",
          "BBB",
          reading(
            "2026-09-14T11:30:00Z",
            0
          )
        ),
        NOW
      ),
      buildFleetVehicleState(
        vehicle(
          "1",
          "AAA",
          reading(
            "2026-09-14T11:59:00Z",
            20
          )
        ),
        NOW
      ),
    ];

    expect(
      sortFleetVehicles(states).map(
        (item) => item.registration
      )
    ).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
  });
});
