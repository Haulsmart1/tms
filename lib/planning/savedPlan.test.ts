import { describe, expect, it } from "vitest";

import {
  createSavedPlanSnapshot,
  parseSavedPlanSnapshot,
  SAVED_PLAN_SNAPSHOT_VERSION,
} from "./savedPlan";

function validSnapshot() {
  return {
    version: SAVED_PLAN_SNAPSHOT_VERSION,
    planningDate: "2026-09-29",
    lanes: [
      {
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        jobIds: ["job-1", "job-2"],
      },
    ],
    canonicalItineraries: [
      {
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        visits: [
          {
            sequenceNumber: 1,
            key: "visit-1",
            requirements: {},
            lat: 51.5,
            lng: -0.1,
          },
        ],
        services: [
          {
            jobId: "job-1",
            stopId: "stop-1",
            visitSequenceNumber: 1,
            serviceSequenceNumber: 1,
            visitServiceOrder: 1,
            stopIndex: 0,
            stopOrder: 1,
            serviceSeconds: 600,
          },
        ],
      },
    ],
  };
}

describe("parseSavedPlanSnapshot", () => {
  it("accepts a valid versioned planning snapshot", () => {
    expect(parseSavedPlanSnapshot(validSnapshot())).toEqual(validSnapshot());
  });

  it("rejects unknown snapshot versions", () => {
    expect(
      parseSavedPlanSnapshot({
        ...validSnapshot(),
        version: 999,
      }),
    ).toBeNull();
  });

  it("rejects duplicate jobs across lanes", () => {
    const snapshot = validSnapshot();

    expect(
      parseSavedPlanSnapshot({
        ...snapshot,
        lanes: [
          ...snapshot.lanes,
          {
            vehicleId: "vehicle-2",
            driverId: null,
            jobIds: ["job-1"],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects duplicate vehicles", () => {
    const snapshot = validSnapshot();

    expect(
      parseSavedPlanSnapshot({
        ...snapshot,
        lanes: [...snapshot.lanes, snapshot.lanes[0]],
      }),
    ).toBeNull();
  });

  it("rejects canonical routes for vehicles outside the plan", () => {
    const snapshot = validSnapshot();

    expect(
      parseSavedPlanSnapshot({
        ...snapshot,
        canonicalItineraries: [
          {
            ...snapshot.canonicalItineraries[0],
            vehicleId: "vehicle-missing",
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects malformed coordinates", () => {
    const snapshot = validSnapshot();

    expect(
      parseSavedPlanSnapshot({
        ...snapshot,
        canonicalItineraries: [
          {
            ...snapshot.canonicalItineraries[0],
            visits: [
              {
                sequenceNumber: 1,
                key: "visit-1",
            requirements: {},
            lat: 200,
                lng: -0.1,
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects canonical services that reference missing visits", () => {
    const snapshot = validSnapshot();

    expect(
      parseSavedPlanSnapshot({
        ...snapshot,
        canonicalItineraries: [
          {
            ...snapshot.canonicalItineraries[0],
            services: [
              {
                ...snapshot.canonicalItineraries[0].services[0],
                visitSequenceNumber: 99,
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("createSavedPlanSnapshot", () => {
  it("captures lane order and persisted canonical routes", () => {
    const snapshot = createSavedPlanSnapshot({
      planningDate: "2026-09-29",
      lanes: [
        {
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          jobIds: ["job-2", "job-1"],
        },
      ],
      pendingItineraries: {},
      persistedItineraries: {
        "vehicle-1": {
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          orderedVisits: [
            {
              key: "visit-1",
              point: { lat: 51.5, lng: -0.1 },
              requirements: {},
            },
          ],
          serviceStops: [
            {
              jobId: "job-2",
              stopId: "stop-2",
              stopIndex: 0,
              stopOrder: 1,
              visitSequenceNumber: 1,
              serviceSequenceNumber: 1,
              visitServiceOrder: 1,
            serviceSeconds: 600,
            },
          ],
        },
      },
    });

    expect(snapshot.lanes[0].jobIds).toEqual(["job-2", "job-1"]);
    expect(snapshot.canonicalItineraries[0].vehicleId).toBe("vehicle-1");
    expect(snapshot.canonicalItineraries[0].visits[0]).toEqual({
      sequenceNumber: 1,
      key: "visit-1",
            requirements: {},
            lat: 51.5,
      lng: -0.1,
    });
  });

  it("prefers pending canonical work over the persisted route", () => {
    const base = {
      vehicleId: "vehicle-1",
      driverId: "driver-1",
      orderedVisits: [
        {
          key: "visit-base",
          point: { lat: 51.5, lng: -0.1 },
          requirements: {},
        },
      ],
      serviceStops: [
        {
          jobId: "job-1",
          stopId: "stop-1",
          stopIndex: 0,
          stopOrder: 1,
          visitSequenceNumber: 1,
          serviceSequenceNumber: 1,
          visitServiceOrder: 1,
            serviceSeconds: 600,
        },
      ],
    };

    const snapshot = createSavedPlanSnapshot({
      planningDate: "2026-09-29",
      lanes: [
        {
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          jobIds: ["job-1"],
        },
      ],
      persistedItineraries: {
        "vehicle-1": base,
      },
      pendingItineraries: {
        "vehicle-1": {
          ...base,
          orderedVisits: [
            {
              key: "visit-optimized",
              point: { lat: 52.0, lng: -1.0 },
              requirements: {},
            },
          ],
        },
      },
    });

    expect(snapshot.canonicalItineraries[0].visits[0].lat).toBe(52);
    expect(snapshot.canonicalItineraries[0].visits[0].lng).toBe(-1);
  });
});