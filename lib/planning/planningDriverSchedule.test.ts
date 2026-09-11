import {
  describe,
  expect,
  it,
} from "vitest";
import type { FastPlotVisit } from "./fastPlot";
import type { DriverHoursState } from "./driverHoursState";
import {
  buildPlanningDriverSchedulePreview,
} from "./planningDriverSchedule";
import type { PlanningServiceStop } from "./physicalItinerary";
import type {
  PlanJob,
  RouteResult,
} from "./types";

const HOUR = 60 * 60;

function job(
  id: string,
  points: Array<[number, number]>
): PlanJob {
  return {
    id,
    tenant_id: "tenant",
    reference: id,
    status: "planned",
    collection_eta: null,
    delivery_eta: null,
    acceptance_note: null,
    accepted_at: null,
    accepted_by: null,
    vehicle_id: "vehicle",
    driver_id: "driver",
    subcontractor_id: null,
    route_order: null,
    customer_name: null,
    journey_scope: "gb_domestic",
    origin_country_code: "GB",
    destination_country_code: "GB",
    compliance_regime_override: null,
    compliance_override_reason: null,
    stops: points.map(
      ([lat, lng], index) => ({
        id: `${id}-${index + 1}`,
        stop_order: index + 1,
        type:
          index === 0
            ? "collection"
            : "delivery",
        address_line: `${id}-${index + 1}`,
        city: null,
        postcode: null,
        lat,
        lng,
      })
    ),
    items: [],
  };
}

function visit(
  key: string,
  lat: number,
  lng: number
): FastPlotVisit {
  return {
    key,
    point: { lat, lng },
    requirements: {},
  };
}

function service(
  sequence: number,
  visitSequence: number,
  jobId: string,
  stopId: string,
  stopIndex: number
): PlanningServiceStop {
  return {
    serviceSequenceNumber: sequence,
    visitSequenceNumber: visitSequence,
    visitServiceOrder: 1,
    jobId,
    stopId,
    stopIndex,
    stopOrder: stopIndex + 1,
    serviceSeconds: 600,
  };
}

function route(
  travelTimes: number[]
): RouteResult {
  return {
    points: [],
    legs: travelTimes.map(
      (travelTimeSeconds) => ({
        distanceMeters: 1000,
        travelTimeSeconds,
      })
    ),
    totalDistanceMeters:
      travelTimes.length * 1000,
    totalTravelTimeSeconds:
      travelTimes.reduce(
        (total, value) => total + value,
        0
      ),
  };
}

function baseInput(): Parameters<
  typeof buildPlanningDriverSchedulePreview
>[0] {
  const value = job(
    "job-a",
    [
      [51.5, -0.1],
      [51.6, -0.2],
    ]
  );

  return {
    jobs: [value],
    orderedVisits: [
      visit("v1", 51.5, -0.1),
      visit("v2", 51.6, -0.2),
    ],
    serviceStops: [
      service(
        1,
        1,
        "job-a",
        "job-a-1",
        0
      ),
      service(
        2,
        2,
        "job-a",
        "job-a-2",
        1
      ),
    ],
    route: route([600]),
    firstTravelSeconds: 300,
    planningProfile:
      "tramper" as const,
    planningDate: "2026-09-10",
    planningStart:
      new Date("2026-09-10T06:00:00Z"),
    driverHoursState: null,
    activityDataAvailable: false,
    startLocationId: "vehicle:1",
    regime: "assimilated" as const,
    regimeReviewRequired: false,
  };
}

describe(
  "buildPlanningDriverSchedulePreview",
  () => {
    it(
      "maps van anchor and TomTom legs without reordering canonical drops",
      () => {
        const result =
          buildPlanningDriverSchedulePreview(
            baseInput()
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.schedule.events
            .filter(
              (event) =>
                event.kind === "drive"
            )
            .map(
              (event) =>
                event.durationSeconds
            )
        ).toEqual([300, 600]);

        expect(
          result.preview.dropEtas.map(
            (drop) => drop.stopId
          )
        ).toEqual([
          "job-a-1",
          "job-a-2",
        ]);

        expect(
          result.preview.schedule.status
        ).toBe("review_required");
      }
    );

    it(
      "rejects a TomTom leg mismatch",
      () => {
        const input = baseInput();

        input.route = route([]);

        expect(
          buildPlanningDriverSchedulePreview(
            input
          )
        ).toEqual({
          ok: false,
          reason: "route_leg_mismatch",
        });
      }
    );

    it(
      "preserves independent shared-location service drops",
      () => {
        const a = job(
          "a",
          [[51.5, -0.1]]
        );
        const b = job(
          "b",
          [[51.5, -0.1]]
        );

        const result =
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            jobs: [a, b],
            orderedVisits: [
              visit(
                "shared",
                51.5,
                -0.1
              ),
            ],
            serviceStops: [
              service(
                1,
                1,
                "b",
                "b-1",
                0
              ),
              {
                ...service(
                  2,
                  1,
                  "a",
                  "a-1",
                  0
                ),
                visitServiceOrder: 2,
              },
            ],
            route: null,
          });

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.dropEtas.map(
            (drop) => drop.stopId
          )
        ).toEqual([
          "b-1",
          "a-1",
        ]);

        expect(
          result.preview.schedule.events
            .filter(
              (event) =>
                event.kind === "drive"
            )
            .map(
              (event) =>
                event.durationSeconds
            )
        ).toEqual([300]);
      }
    );

    it(
      "uses existing driver state to insert a required break",
      () => {
        const input = baseInput();

        input.firstTravelSeconds = HOUR;

        input.driverHoursState = {
          complete: true,
          continuousDrivingSeconds:
            4 * HOUR,
          dailyDrivingSeconds:
            4 * HOUR,
          currentWeekDrivingSeconds:
            4 * HOUR,
          fortnightDrivingSeconds:
            4 * HOUR,
        } as unknown as DriverHoursState;

        input.activityDataAvailable = true;

        const result =
          buildPlanningDriverSchedulePreview(
            input
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.schedule.events
            .filter(
              (event) =>
                event.kind === "break" ||
                event.kind === "drive"
            )
            .slice(0, 2)
            .map(
              (event) => event.kind
            )
        ).toEqual([
          "break",
          "drive",
        ]);
      }
    );

    it(
      "does not invent a DAY return base",
      () => {
        expect(
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            planningProfile: "day",
          })
        ).toEqual({
          ok: false,
          reason:
            "day_base_unavailable",
        });
      }
    );

    it(
      "refuses a regime needing review",
      () => {
        expect(
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            regimeReviewRequired: true,
          })
        ).toEqual({
          ok: false,
          reason:
            "unsupported_regime",
        });
      }
    );
  }
);
