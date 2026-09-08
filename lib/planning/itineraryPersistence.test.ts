import { describe, expect, it } from "vitest";
import {
  buildPlanningItineraryRpcVisits,
  parsePersistedPlanningItineraries,
  PLANNING_ITINERARY_SERVICE_SECONDS,
} from "./itineraryPersistence";
import type { FastPlotVisit } from "./fastPlot";
import type { PlanningServiceStop } from "./physicalItinerary";

const visits: FastPlotVisit[] = [
  {
    key: "a",
    point: { lat: 51, lng: -1 },
    requirements: { jobB: [0], jobA: [0] },
  },
  {
    key: "b",
    point: { lat: 52, lng: -2 },
    requirements: { jobB: [1], jobC: [0] },
  },
  {
    key: "c",
    point: { lat: 53, lng: -3 },
    requirements: { jobA: [1] },
  },
];

const services: PlanningServiceStop[] = [
  {
    serviceSequenceNumber: 1,
    visitSequenceNumber: 1,
    visitServiceOrder: 1,
    jobId: "jobB",
    stopId: "b-collection",
    stopIndex: 0,
    stopOrder: 10,
    serviceSeconds: 600,
  },
  {
    serviceSequenceNumber: 2,
    visitSequenceNumber: 1,
    visitServiceOrder: 2,
    jobId: "jobA",
    stopId: "a-collection",
    stopIndex: 0,
    stopOrder: 20,
    serviceSeconds: 600,
  },
  {
    serviceSequenceNumber: 3,
    visitSequenceNumber: 2,
    visitServiceOrder: 1,
    jobId: "jobB",
    stopId: "b-delivery",
    stopIndex: 1,
    stopOrder: 30,
    serviceSeconds: 600,
  },
  {
    serviceSequenceNumber: 4,
    visitSequenceNumber: 2,
    visitServiceOrder: 2,
    jobId: "jobC",
    stopId: "c-collection",
    stopIndex: 0,
    stopOrder: 40,
    serviceSeconds: 600,
  },
  {
    serviceSequenceNumber: 5,
    visitSequenceNumber: 3,
    visitServiceOrder: 1,
    jobId: "jobA",
    stopId: "a-delivery",
    stopIndex: 1,
    stopOrder: 50,
    serviceSeconds: 600,
  },
];

describe("buildPlanningItineraryRpcVisits", () => {
  it("preserves physical visit order and multiple services at one coordinate", () => {
    const payload = buildPlanningItineraryRpcVisits(visits, services);

    expect(payload).toEqual([
      {
        lat: 51,
        lng: -1,
        service_stops: [
          {
            job_id: "jobB",
            stop_id: "b-collection",
            service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
          },
          {
            job_id: "jobA",
            stop_id: "a-collection",
            service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
          },
        ],
      },
      {
        lat: 52,
        lng: -2,
        service_stops: [
          {
            job_id: "jobB",
            stop_id: "b-delivery",
            service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
          },
          {
            job_id: "jobC",
            stop_id: "c-collection",
            service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
          },
        ],
      },
      {
        lat: 53,
        lng: -3,
        service_stops: [
          {
            job_id: "jobA",
            stop_id: "a-delivery",
            service_seconds: PLANNING_ITINERARY_SERVICE_SECONDS,
          },
        ],
      },
    ]);
  });

  it("rejects reordered global service sequence", () => {
    const reordered = [...services];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];

    expect(() =>
      buildPlanningItineraryRpcVisits(visits, reordered)
    ).toThrow("Canonical service sequence is not contiguous");
  });

  it("rejects a service assigned to a missing visit", () => {
    const invalid = services.map((service) => ({ ...service }));
    invalid[0].visitSequenceNumber = 99;

    expect(() =>
      buildPlanningItineraryRpcVisits(visits, invalid)
    ).toThrow("references an unknown physical visit");
  });

  it("rejects non-600-second services", () => {
    const invalid = services.map((service) => ({ ...service }));
    invalid[0].serviceSeconds = 599;

    expect(() =>
      buildPlanningItineraryRpcVisits(visits, invalid)
    ).toThrow("must consume 600 seconds");
  });
});


describe("parsePersistedPlanningItineraries", () => {
  const jobs = [
    {
      id: "jobA",
      vehicle_id: "vehicle-1",
      stops: [
        { id: "a-collection", stop_order: 10 },
        { id: "a-delivery", stop_order: 50 },
      ],
    },
    {
      id: "jobB",
      vehicle_id: "vehicle-1",
      stops: [
        { id: "b-collection", stop_order: 10 },
        { id: "b-delivery", stop_order: 30 },
      ],
    },
    {
      id: "jobC",
      vehicle_id: "vehicle-1",
      stops: [{ id: "c-collection", stop_order: 40 }],
    },
  ];

  const itineraryRows = [
    {
      id: "itinerary-1",
      vehicle_id: "vehicle-1",
      driver_id: "driver-1",
    },
  ];

  const visitRows = [
    {
      id: "visit-1",
      itinerary_id: "itinerary-1",
      sequence_number: 1,
      lat: 51,
      lng: -1,
    },
    {
      id: "visit-2",
      itinerary_id: "itinerary-1",
      sequence_number: 2,
      lat: 52,
      lng: -2,
    },
    {
      id: "visit-3",
      itinerary_id: "itinerary-1",
      sequence_number: 3,
      lat: 53,
      lng: -3,
    },
  ];

  const serviceRows = [
    {
      itinerary_id: "itinerary-1",
      visit_id: "visit-1",
      service_sequence_number: 1,
      visit_service_order: 1,
      job_id: "jobB",
      stop_id: "b-collection",
      service_seconds: 600,
    },
    {
      itinerary_id: "itinerary-1",
      visit_id: "visit-1",
      service_sequence_number: 2,
      visit_service_order: 2,
      job_id: "jobA",
      stop_id: "a-collection",
      service_seconds: 600,
    },
    {
      itinerary_id: "itinerary-1",
      visit_id: "visit-2",
      service_sequence_number: 3,
      visit_service_order: 1,
      job_id: "jobB",
      stop_id: "b-delivery",
      service_seconds: 600,
    },
    {
      itinerary_id: "itinerary-1",
      visit_id: "visit-2",
      service_sequence_number: 4,
      visit_service_order: 2,
      job_id: "jobC",
      stop_id: "c-collection",
      service_seconds: 600,
    },
    {
      itinerary_id: "itinerary-1",
      visit_id: "visit-3",
      service_sequence_number: 5,
      visit_service_order: 1,
      job_id: "jobA",
      stop_id: "a-delivery",
      service_seconds: 600,
    },
  ];

  it("restores canonical physical and service identity", () => {
    const restored = parsePersistedPlanningItineraries(
      itineraryRows,
      visitRows,
      serviceRows,
      jobs
    );

    expect(
      restored["vehicle-1"].orderedVisits.map((visit) => visit.point)
    ).toEqual([
      { lat: 51, lng: -1 },
      { lat: 52, lng: -2 },
      { lat: 53, lng: -3 },
    ]);

    expect(
      restored["vehicle-1"].serviceStops.map((service) => service.stopId)
    ).toEqual([
      "b-collection",
      "a-collection",
      "b-delivery",
      "c-collection",
      "a-delivery",
    ]);
  });

  it("rejects a persisted itinerary missing a lane stop", () => {
    const restored = parsePersistedPlanningItineraries(
      itineraryRows,
      visitRows,
      serviceRows.slice(0, -1),
      jobs
    );

    expect(restored).toEqual({});
  });

  it("rejects a persisted service attached to the wrong vehicle", () => {
    const wrongJobs = jobs.map((job) =>
      job.id === "jobB"
        ? { ...job, vehicle_id: "vehicle-2" }
        : job
    );

    const restored = parsePersistedPlanningItineraries(
      itineraryRows,
      visitRows,
      serviceRows,
      wrongJobs
    );

    expect(restored).toEqual({});
  });
});
