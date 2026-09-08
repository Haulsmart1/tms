import { describe, expect, it } from "vitest";
import type { FastPlotVisit } from "./fastPlot";
import {
  buildPlanningDropMarkers,
  buildPlanningDropNumbersByJobId,
} from "./dropPresentation";
import type { PlanningServiceStop } from "./physicalItinerary";

function service(
  serviceSequenceNumber: number,
  visitSequenceNumber: number,
  jobId: string,
  stopId: string,
  visitServiceOrder = 1,
): PlanningServiceStop {
  return {
    serviceSequenceNumber,
    visitSequenceNumber,
    visitServiceOrder,
    jobId,
    stopId,
    stopIndex: 0,
    stopOrder: serviceSequenceNumber,
    serviceSeconds: 600,
  };
}

describe("planning drop presentation", () => {
  it("maps a multi-stop job to every canonical Drop number", () => {
    const serviceStops = [
      service(1, 1, "job-a", "a-collection"),
      service(2, 2, "job-b", "b-collection"),
      service(3, 3, "job-a", "a-delivery"),
    ];

    expect(buildPlanningDropNumbersByJobId(serviceStops)).toEqual({
      "job-a": [1, 3],
      "job-b": [2],
    });
  });

  it("labels shared physical visits with every service Drop at that visit", () => {
    const visits: FastPlotVisit[] = [
      {
        key: "shared-a",
        point: { lat: 52.1, lng: -1.1 },
        requirements: {
          "job-a": [0],
          "job-b": [0],
        },
      },
      {
        key: "shared-b",
        point: { lat: 52.2, lng: -1.2 },
        requirements: {
          "job-a": [1],
        },
      },
    ];

    const serviceStops = [
      service(1, 1, "job-a", "a-collection", 1),
      service(2, 1, "job-b", "b-collection", 2),
      service(3, 2, "job-a", "a-delivery", 1),
    ];

    expect(buildPlanningDropMarkers(visits, serviceStops)).toEqual([
      {
        position: { lat: 52.1, lng: -1.1 },
        label: "1/2",
      },
      {
        position: { lat: 52.2, lng: -1.2 },
        label: "3",
      },
    ]);
  });

  it("rejects non-contiguous canonical service numbering", () => {
    expect(() =>
      buildPlanningDropNumbersByJobId([
        service(1, 1, "job-a", "a"),
        service(3, 2, "job-b", "b"),
      ]),
    ).toThrow(/contiguous/);
  });

  it("rejects a service Drop pointing at a missing physical visit", () => {
    const visits: FastPlotVisit[] = [{
      key: "only",
      point: { lat: 52.1, lng: -1.1 },
      requirements: { "job-a": [0] },
    }];

    expect(() =>
      buildPlanningDropMarkers(
        visits,
        [service(1, 2, "job-a", "a")],
      ),
    ).toThrow(/missing physical visit/);
  });
});
