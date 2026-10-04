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

    it(
      "splits the canonical itinerary across route days without changing task order",
      () => {
        const value = job(
          "job-a",
          [
            [51.5, -0.1],
            [51.6, -0.2],
            [51.7, -0.3],
          ]
        );

        const result =
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            driverHoursState: {
              complete: true,
              continuousDrivingSeconds: 0,
              dailyDrivingSeconds: 8 * HOUR,
              currentWeekDrivingSeconds: 8 * HOUR,
              fortnightDrivingSeconds: 8 * HOUR,
            } as unknown as DriverHoursState,
            activityDataAvailable: true,
            jobs: [value],
            orderedVisits: [
              visit("v1", 51.5, -0.1),
              visit("v2", 51.6, -0.2),
              visit("v3", 51.7, -0.3),
            ],
            serviceStops: [
              {
                ...service(
                  1,
                  1,
                  "job-a",
                  "job-a-1",
                  0
                ),
                serviceSeconds: 600,
              },
              {
                ...service(
                  2,
                  2,
                  "job-a",
                  "job-a-2",
                  1
                ),
                serviceSeconds: 600,
              },
              {
                ...service(
                  3,
                  3,
                  "job-a",
                  "job-a-3",
                  2
                ),
                serviceSeconds: 600,
              },
            ],
            firstTravelSeconds: HOUR,
            route: route([
              HOUR,
              HOUR,
            ]),
          });

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.routeDays.length
        ).toBeGreaterThan(1);

        expect(
          result.preview.routeDays.flatMap(
            (day) => day.taskIds
          )
        ).toEqual([
          "stop:job-a-1",
          "stop:job-a-2",
          "stop:job-a-3",
        ]);

        expect(
          result.preview.dropEtas.map(
            (drop) => drop.stopId
          )
        ).toEqual([
          "job-a-1",
          "job-a-2",
          "job-a-3",
        ]);
      }
    );

    it(
      "supports confirmed GB domestic goods scheduling without assimilated break state",
      () => {
        const input = baseInput();

        input.regime = "gb_domestic";
        input.firstTravelSeconds = 5 * HOUR;
        input.route = route([HOUR]);

        input.driverHoursState = {
          complete: true,
          continuousDrivingSeconds: 4 * HOUR,
          dailyDrivingSeconds: 4 * HOUR,
          currentWeekDrivingSeconds: 55 * HOUR,
          fortnightDrivingSeconds: 89 * HOUR,
        } as unknown as DriverHoursState;

        input.activityDataAvailable = true;

        const result =
          buildPlanningDriverSchedulePreview(input);

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.schedule.events.some(
            (event) => event.kind === "break"
          )
        ).toBe(false);

        expect(
          result.preview.schedule.status
        ).toBe("review_required");

        expect(
          result.preview.dropEtas.map(
            (drop) => drop.stopId
          )
        ).toEqual([
          "job-a-1",
          "job-a-2",
        ]);
      }
    );

    it(
      "limits a horizon-exceeded GB domestic preview to the visible seven days",
      () => {
        const points: Array<
          [number, number]
        > = [
          [51.50, -0.10],
          [51.51, -0.11],
          [51.52, -0.12],
          [51.53, -0.13],
          [51.54, -0.14],
          [51.55, -0.15],
          [51.56, -0.16],
          [51.57, -0.17],
        ];

        const value = job(
          "job-horizon",
          points
        );

        const result =
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            regime: "gb_domestic",
            jobs: [value],
            orderedVisits: points.map(
              ([lat, lng], index) =>
                visit(
                  `horizon-${index + 1}`,
                  lat,
                  lng
                )
            ),
            serviceStops: points.map(
              (_, index) =>
                service(
                  index + 1,
                  index + 1,
                  "job-horizon",
                  `job-horizon-${index + 1}`,
                  index
                )
            ),
            firstTravelSeconds: 10 * HOUR,
            route: route(
              Array(7).fill(10 * HOUR)
            ),
            driverHoursState: null,
            activityDataAvailable: false,
          });

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.preview.horizonExceeded
        ).toBe(true);

        expect(
          result.preview.routeDays
        ).toHaveLength(7);

        expect(
          result.preview.routeDays.flatMap(
            (day) => day.taskIds
          )
        ).toEqual([
          "stop:job-horizon-1",
          "stop:job-horizon-2",
          "stop:job-horizon-3",
          "stop:job-horizon-4",
          "stop:job-horizon-5",
          "stop:job-horizon-6",
          "stop:job-horizon-7",
        ]);

        expect(
          result.preview.remainingTaskIds
        ).toEqual([
          "stop:job-horizon-8",
        ]);

        expect(
          result.preview.schedule.completedTaskIds
        ).toEqual([
          "stop:job-horizon-1",
          "stop:job-horizon-2",
          "stop:job-horizon-3",
          "stop:job-horizon-4",
          "stop:job-horizon-5",
          "stop:job-horizon-6",
          "stop:job-horizon-7",
        ]);

        expect(
          result.preview.schedule.unscheduledTaskIds
        ).toEqual([
          "stop:job-horizon-8",
        ]);

        const visibleDays = new Set(
          result.preview.routeDays.map(
            (day) => day.day
          )
        );

        expect(
          result.preview.schedule.events.every(
            (event) =>
              visibleDays.has(event.day)
          )
        ).toBe(true);

        expect(
          result.preview.schedule.days.every(
            (day) =>
              visibleDays.has(day.day)
          )
        ).toBe(true);

        expect(
          result.preview.schedule.events.some(
            (event) => event.day > 7
          )
        ).toBe(false);

        expect(
          result.preview.schedule.days.some(
            (day) => day.day > 7
          )
        ).toBe(false);

        expect(
          result.preview.dropEtas.map(
            (drop) => drop.stopId
          )
        ).toEqual([
          "job-horizon-1",
          "job-horizon-2",
          "job-horizon-3",
          "job-horizon-4",
          "job-horizon-5",
          "job-horizon-6",
          "job-horizon-7",
        ]);

        expect(
          result.preview.dropEtas.some(
            (drop) =>
              drop.stopId ===
              "job-horizon-8"
          )
        ).toBe(false);
      }
    );
    it(
      "keeps GB domestic review-required lanes blocked",
      () => {
        expect(
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            regime: "gb_domestic",
            regimeReviewRequired: true,
          })
        ).toEqual({
          ok: false,
          reason: "unsupported_regime",
        });
      }
    );

    it(
      "rejects unsupported non-domestic regimes",
      () => {
        expect(
          buildPlanningDriverSchedulePreview({
            ...baseInput(),
            regime: "aetr",
          })
        ).toEqual({
          ok: false,
          reason: "unsupported_regime",
        });
      }
    );
  }
);
