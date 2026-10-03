import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildFastPlotVisits,
} from "./fastPlot";

import type {
  FastPlotVisit,
} from "./fastPlot";

import type {
  LatLng,
  PlanJob,
  PlanStop,
} from "./types";

import productionFixture from "./fixtures/large-shared-terminal-regression.json";

import {
  buildGeographicMasterRoute,
  buildMasterRoute,
  buildMasterRouteGraph,
  routeMaintainsMasterPrecedence,
} from "./masterRoute";

function visit(
  key: string,
  lat: number,
  lng: number,
  requirements: Record<
    string,
    number[]
  >
): FastPlotVisit {
  return {
    key,
    point: {
      lat,
      lng,
    },
    requirements,
  };
}

describe("Master Route V1", () => {
  it(
    "preserves collection-before-delivery precedence",
    () => {
      const collection = visit(
        "collection",
        52,
        -1,
        {
          jobA: [0],
        }
      );

      const delivery = visit(
        "delivery",
        53,
        -2,
        {
          jobA: [1],
        }
      );

      const result = buildMasterRoute([
        delivery,
        collection,
      ]);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(
        result.route.map(
          (item) => item.key
        )
      ).toEqual([
        "collection",
        "delivery",
      ]);

      expect(
        routeMaintainsMasterPrecedence(
          result.route,
          result.graph
        )
      ).toBe(true);
    }
  );

  it(
    "keeps future physical obligations in the graph before they are eligible",
    () => {
      const visits = [
        visit(
          "a-collection",
          55,
          -3,
          {
            jobA: [0],
          }
        ),
        visit(
          "a-delivery",
          51,
          -3,
          {
            jobA: [1],
          }
        ),
        visit(
          "b-collection",
          54,
          1,
          {
            jobB: [0],
          }
        ),
        visit(
          "b-delivery",
          50,
          1,
          {
            jobB: [1],
          }
        ),
      ];

      const graph =
        buildMasterRouteGraph(visits);

      expect(graph).not.toBeNull();
      expect(graph?.visitCount).toBe(4);
      expect(graph?.edgeCount).toBe(2);

      expect(
        graph?.nodes
          .get("a-delivery")
          ?.predecessors.has(
            "a-collection"
          )
      ).toBe(true);

      expect(
        graph?.nodes
          .get("b-delivery")
          ?.predecessors.has(
            "b-collection"
          )
      ).toBe(true);
    }
  );

  it(
    "supports a shared physical visit required by multiple jobs",
    () => {
      const firstA = visit(
        "a",
        52,
        -2,
        {
          jobA: [0],
        }
      );

      const firstB = visit(
        "b",
        52.5,
        -2,
        {
          jobB: [0],
        }
      );

      const shared = visit(
        "shared",
        53,
        -2,
        {
          jobA: [1],
          jobB: [1],
        }
      );

      const result = buildMasterRoute([
        shared,
        firstB,
        firstA,
      ]);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      const sharedIndex =
        result.route.findIndex(
          (item) =>
            item.key === "shared"
        );

      expect(sharedIndex).toBe(2);
    }
  );

  it(
    "collapses consecutive requirements at one physical location",
    () => {
      const first = visit(
        "first",
        52,
        -1,
        {
          jobA: [0],
        }
      );

      const shared = visit(
        "shared",
        53,
        -1,
        {
          jobA: [1, 2],
        }
      );

      const last = visit(
        "last",
        54,
        -1,
        {
          jobA: [3],
        }
      );

      const graph =
        buildMasterRouteGraph([
          last,
          shared,
          first,
        ]);

      expect(graph).not.toBeNull();
      expect(graph?.edgeCount).toBe(2);

      const result =
        buildMasterRoute([
          last,
          shared,
          first,
        ]);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(
        result.route.map(
          (item) => item.key
        )
      ).toEqual([
        "first",
        "shared",
        "last",
      ]);
    }
  );

  it(
    "rejects contradictory physical precedence",
    () => {
      const a = visit(
        "a",
        52,
        -1,
        {
          jobA: [0],
          jobB: [1],
        }
      );

      const b = visit(
        "b",
        53,
        -1,
        {
          jobA: [1],
          jobB: [0],
        }
      );

      const result =
        buildMasterRoute([a, b]);

      expect(result).toEqual({
        ok: false,
        reason: "precedence_cycle",
      });
    }
  );

  it(
    "handles 1000 physical visits without a routing matrix",
    () => {
      const visits: FastPlotVisit[] =
        Array.from(
          {
            length: 1000,
          },
          (_, index) =>
            visit(
              `stop-${String(
                index
              ).padStart(4, "0")}`,
              50 + index * 0.001,
              -3,
              {
                largeJob: [index],
              }
            )
        );

      const result =
        buildMasterRoute(visits);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.route).toHaveLength(
        1000
      );

      expect(
        result.route[0].key
      ).toBe("stop-0000");

      expect(
        result.route[999].key
      ).toBe("stop-0999");

      expect(
        routeMaintainsMasterPrecedence(
          result.route,
          result.graph
        )
      ).toBe(true);
    }
  );

  it(
    "anchors geographic Drop 1 from the supplied start point",
    () => {
      const north = visit(
        "north",
        55,
        -2,
        {}
      );

      const south = visit(
        "south",
        50,
        -2,
        {}
      );

      const result =
        buildGeographicMasterRoute(
          [north, south],
          {
            start: {
              lat: 50.1,
              lng: -2,
            },
          }
        );

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(
        result.route.map(
          (item) => item.key
        )
      ).toEqual([
        "south",
        "north",
      ]);
    }
  );

  it(
    "preserves locked collection-delivery obligations during geographic planning",
    () => {
      const nearbyCollection = visit(
        "nearby-collection",
        51,
        0,
        {
          nearbyJob: [0],
        }
      );

      const nearbyDelivery = visit(
        "nearby-delivery",
        55,
        0,
        {
          nearbyJob: [1],
        }
      );

      const corridorCollection = visit(
        "corridor-collection",
        51.15,
        0,
        {
          corridorJob: [0],
        }
      );

      const corridorDelivery = visit(
        "corridor-delivery",
        51.3,
        0,
        {
          corridorJob: [1],
        }
      );

      const result =
        buildGeographicMasterRoute(
          [
            nearbyCollection,
            nearbyDelivery,
            corridorCollection,
            corridorDelivery,
          ],
          {
            start: {
              lat: 50.9,
              lng: 0,
            },
          }
        );

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      const positions =
        new Map(
          result.route.map(
            (item, index) =>
              [
                item.key,
                index,
              ] as const
          )
        );

      const nearbyCollectionIndex =
        positions.get(
          "nearby-collection"
        );

      const nearbyDeliveryIndex =
        positions.get(
          "nearby-delivery"
        );

      const corridorCollectionIndex =
        positions.get(
          "corridor-collection"
        );

      const corridorDeliveryIndex =
        positions.get(
          "corridor-delivery"
        );

      expect(
        nearbyCollectionIndex
      ).toBeDefined();

      expect(
        nearbyDeliveryIndex
      ).toBeDefined();

      expect(
        corridorCollectionIndex
      ).toBeDefined();

      expect(
        corridorDeliveryIndex
      ).toBeDefined();

      expect(
        nearbyCollectionIndex!
      ).toBeLessThan(
        nearbyDeliveryIndex!
      );

      expect(
        corridorCollectionIndex!
      ).toBeLessThan(
        corridorDeliveryIndex!
      );

      expect(
        result.graph.nodes.get(
          "nearby-collection"
        )?.successors.has(
          "nearby-delivery"
        )
      ).toBe(true);

      expect(
        result.graph.nodes.get(
          "corridor-collection"
        )?.successors.has(
          "corridor-delivery"
        )
      ).toBe(true);

      expect(
        routeMaintainsMasterPrecedence(
          result.route,
          result.graph
        )
      ).toBe(true);
    }
  );

  it(
    "is deterministic when geographic candidate costs tie",
    () => {
      const a = visit(
        "a",
        51,
        -1,
        {}
      );

      const b = visit(
        "b",
        51,
        1,
        {}
      );

      const first =
        buildGeographicMasterRoute(
          [b, a],
          {
            start: {
              lat: 50,
              lng: 0,
            },
          }
        );

      const second =
        buildGeographicMasterRoute(
          [a, b],
          {
            start: {
              lat: 50,
              lng: 0,
            },
          }
        );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      if (
        !first.ok ||
        !second.ok
      ) {
        return;
      }

      expect(
        first.route.map(
          (item) => item.key
        )
      ).toEqual(
        second.route.map(
          (item) => item.key
        )
      );
    }
  );

  it(
    "geographically builds 1000 physical visits without a matrix",
    () => {
      const visits: FastPlotVisit[] =
        Array.from(
          {
            length: 1000,
          },
          (_, index) =>
            visit(
              `geo-${String(
                index
              ).padStart(4, "0")}`,
              50 + index * 0.001,
              -2,
              {
                largeJob: [index],
              }
            )
        );

      const result =
        buildGeographicMasterRoute(
          visits,
          {
            start: {
              lat: 50,
              lng: -2,
            },
          }
        );

      expect(result.ok).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(
        result.route
      ).toHaveLength(1000);

      expect(
        result.route[0].key
      ).toBe("geo-0000");

      expect(
        result.route[999].key
      ).toBe("geo-0999");

      expect(
        routeMaintainsMasterPrecedence(
          result.route,
          result.graph
        )
      ).toBe(true);
    }
  );
});

function regressionStop(
  id: string,
  order: number,
  type: string,
  lat: number,
  lng: number
): PlanStop {
  return {
    id,
    stop_order: order,
    type,
    address_line: id,
    city: null,
    postcode: null,
    lat,
    lng,
  };
}

function regressionJob(
  id: string,
  stops: PlanStop[]
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
    driver_id: null,
    subcontractor_id: null,
    route_order: null,
    customer_name: null,
    stops,
  };
}

function regressionHopKm(
  left: LatLng,
  right: LatLng
): number {
  const toRadians = (
    degrees: number
  ): number =>
    (degrees * Math.PI) / 180;

  const deltaLat = toRadians(
    right.lat - left.lat
  );

  const deltaLng = toRadians(
    right.lng - left.lng
  );

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(left.lat)) *
      Math.cos(toRadians(right.lat)) *
      Math.sin(deltaLng / 2) ** 2;

  return (
    6371 *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}

function longestRegressionHop(
  route: FastPlotVisit[]
): {
  km: number;
  index: number;
} {
  if (route.length < 2) {
    return {
      km: 0,
      index: -1,
    };
  }

  let bestKm = -1;
  let bestIndex = 0;

  for (
    let index = 0;
    index < route.length - 1;
    index++
  ) {
    const km = regressionHopKm(
      route[index].point,
      route[index + 1].point
    );

    if (km > bestKm) {
      bestKm = km;
      bestIndex = index;
    }
  }

  return {
    km: bestKm,
    index: bestIndex,
  };
}

describe(
  "Master Route geographic regressions",
  () => {
    it(
      "does not return north late in the 220-visit nationwide lane",
      () => {
        const jobs = Array.from(
          {
            length: 110,
          },
          (_, index) => {
            const fraction =
              index / 109;

            const collectionLat =
              55.8 -
              fraction * 5.7;

            const collectionLng =
              -2.4 +
              Math.sin(
                index * 0.73
              ) *
                1.35;

            const deliveryLat =
              collectionLat -
              0.08 -
              (index % 4) *
                0.015;

            const deliveryLng =
              collectionLng +
              ((index % 5) - 2) *
                0.035;

            return regressionJob(
              `uk-sweep-${index}`,
              [
                regressionStop(
                  `uk-sweep-c-${index}`,
                  1,
                  "collection",
                  collectionLat,
                  collectionLng
                ),
                regressionStop(
                  `uk-sweep-d-${index}`,
                  2,
                  "delivery",
                  deliveryLat,
                  deliveryLng
                ),
              ]
            );
          }
        );

        const visits =
          buildFastPlotVisits(jobs);

        expect(visits).toHaveLength(
          220
        );

        const result =
          buildGeographicMasterRoute(
            visits,
            {
              start: {
                lat: 55.9,
                lng: -2.4,
              },
            }
          );

        expect(result.ok).toBe(true);

        if (!result.ok) {
          return;
        }

        expect(
          result.route
        ).toHaveLength(220);

        expect(
          result.route[0]
            ?.requirements[
              "uk-sweep-0"
            ]
            ?.includes(0)
        ).toBe(true);

        expect(
          routeMaintainsMasterPrecedence(
            result.route,
            result.graph
          )
        ).toBe(true);

        const firstSouthernIndex =
          result.route.findIndex(
            (item) =>
              item.point.lat <= 51.5
          );

        const finalQuarter =
          result.route.slice(
            Math.floor(
              result.route.length *
                0.75
            )
          );

        const northernReturns =
          finalQuarter.filter(
            (item) =>
              item.point.lat >= 53.5
          ).length;

        const lateNorthernIndex =
          result.route.findIndex(
            (item, index) =>
              index >
                firstSouthernIndex +
                  50 &&
              item.point.lat >= 53.5
          );

        const longest =
          longestRegressionHop(
            result.route
          );

        console.log(
          "MASTER_NATIONWIDE",
          {
            visits:
              result.route.length,
            firstSouthernIndex,
            northernReturns,
            lateNorthernIndex,
            longestHopKm:
              longest.km,
            longestHop:
              [
                longest.index + 1,
                longest.index + 2,
              ],
          }
        );

        expect(
          firstSouthernIndex
        ).toBeGreaterThanOrEqual(0);

        expect(
          northernReturns
        ).toBeLessThanOrEqual(5);

        expect(
          lateNorthernIndex
        ).toBe(-1);
      },
      15_000
    );

    it(
      "does not reopen distant regions in the 216-visit multi-region lane",
      () => {
        const centres: LatLng[] = [
          {
            lat: 55.75,
            lng: -3.2,
          },
          {
            lat: 54.95,
            lng: -1.6,
          },
          {
            lat: 54.35,
            lng: -3.0,
          },
          {
            lat: 53.75,
            lng: -1.5,
          },
          {
            lat: 53.35,
            lng: -3.0,
          },
          {
            lat: 52.9,
            lng: -1.4,
          },
          {
            lat: 52.45,
            lng: -3.2,
          },
          {
            lat: 52.2,
            lng: -0.5,
          },
          {
            lat: 51.75,
            lng: -3.1,
          },
          {
            lat: 51.45,
            lng: -1.1,
          },
          {
            lat: 51.15,
            lng: -3.0,
          },
          {
            lat: 51.0,
            lng: 0.3,
          },
        ];

        const jobs = Array.from(
          {
            length: 108,
          },
          (_, index) => {
            const regionIndex =
              index %
              centres.length;

            const pass =
              Math.floor(
                index /
                  centres.length
              );

            const centre =
              centres[
                regionIndex
              ]!;

            const offset =
              (pass - 4) *
              0.025;

            const collectionLat =
              centre.lat +
              offset;

            const collectionLng =
              centre.lng +
              ((pass % 3) - 1) *
                0.04;

            const deliveryLat =
              collectionLat -
              0.035;

            const deliveryLng =
              collectionLng +
              (
                pass % 2 === 0
                  ? 0.045
                  : -0.045
              );

            return regressionJob(
              `multi-region-${index}`,
              [
                regressionStop(
                  `multi-region-c-${index}`,
                  1,
                  "collection",
                  collectionLat,
                  collectionLng
                ),
                regressionStop(
                  `multi-region-d-${index}`,
                  2,
                  "delivery",
                  deliveryLat,
                  deliveryLng
                ),
              ]
            );
          }
        );

        const visits =
          buildFastPlotVisits(jobs);

        expect(visits).toHaveLength(
          216
        );

        const result =
          buildGeographicMasterRoute(
            visits,
            {
              start: {
                lat: 55.8,
                lng: -3.2,
              },
            }
          );

        expect(result.ok).toBe(true);

        if (!result.ok) {
          return;
        }

        expect(
          routeMaintainsMasterPrecedence(
            result.route,
            result.graph
          )
        ).toBe(true);

        const firstSouthernIndex =
          result.route.findIndex(
            (item) =>
              item.point.lat <= 51.5
          );

        const reopenedNorth =
          result.route.findIndex(
            (item, index) =>
              index >
                firstSouthernIndex +
                  30 &&
              item.point.lat >= 53
          );

        const firstSouthEastIndex =
          result.route.findIndex(
            (item) =>
              item.point.lat <=
                52.2 &&
              item.point.lng >=
                -1.2
          );

        const reopenedFarWest =
          result.route.findIndex(
            (item, index) =>
              index >
                firstSouthEastIndex +
                  30 &&
              item.point.lng <=
                -2.5
          );

        const longest =
          longestRegressionHop(
            result.route
          );

        console.log(
          "MASTER_MULTI_REGION",
          {
            visits:
              result.route.length,
            firstSouthernIndex,
            reopenedNorth,
            firstSouthEastIndex,
            reopenedFarWest,
            longestHopKm:
              longest.km,
            longestHop:
              [
                longest.index + 1,
                longest.index + 2,
              ],
          }
        );

        expect(
          firstSouthernIndex
        ).toBeGreaterThanOrEqual(0);

        expect(
          reopenedNorth
        ).toBe(-1);

        expect(
          firstSouthEastIndex
        ).toBeGreaterThanOrEqual(0);

        expect(
          reopenedFarWest
        ).toBe(-1);
      },
      15_000
    );

    it(
      "keeps the production 211-physical-stop route below a 150 km hop",
      () => {
        const jobs =
          productionFixture.jobs
            .map(
              (
                fixtureJob
              ): PlanJob =>
                regressionJob(
                  fixtureJob.id,
                  fixtureJob.stops.map(
                    (
                      fixtureStop
                    ): PlanStop =>
                      regressionStop(
                        fixtureStop.id,
                        fixtureStop.stop_order,
                        fixtureStop.type,
                        fixtureStop.lat,
                        fixtureStop.lng
                      )
                  )
                )
            );

        const visits =
          buildFastPlotVisits(jobs);

        console.log(
          "MASTER_PRODUCTION_INPUT",
          {
            jobs: jobs.length,
            physicalVisits:
              visits.length,
          }
        );

        expect(visits).toHaveLength(
          211
        );

        const result =
          buildGeographicMasterRoute(
            visits,
            {
              start:
                productionFixture.start,
            }
          );

        expect(result.ok).toBe(true);

        if (!result.ok) {
          return;
        }

        expect(
          routeMaintainsMasterPrecedence(
            result.route,
            result.graph
          )
        ).toBe(true);

        const longest =
          longestRegressionHop(
            result.route
          );

        const from =
          longest.index >= 0
            ? result.route[
                longest.index
              ]
            : undefined;

        const to =
          longest.index >= 0
            ? result.route[
                longest.index + 1
              ]
            : undefined;

        console.log(
          "MASTER_PRODUCTION",
          {
            visits:
              result.route.length,
            longestHopKm:
              longest.km,
            longestHop:
              [
                longest.index + 1,
                longest.index + 2,
              ],
            from:
              from?.point,
            to:
              to?.point,
          }
        );

        expect(
          longest.km,
          `worst hop ${
            longest.index + 1
          }->${
            longest.index + 2
          }: ${JSON.stringify(
            from?.point
          )} -> ${JSON.stringify(
            to?.point
          )}`
        ).toBeLessThan(150);
      },
      15_000
    );
  }
);
