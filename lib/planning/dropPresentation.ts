import type { FastPlotVisit } from "./fastPlot";
import type { PlanningServiceStop } from "./physicalItinerary";
import type { LatLng } from "./types";

export type PlanningDropMarker = {
  position: LatLng;
  label: string;
};

export function buildPlanningDropNumbersByJobId(
  serviceStops: PlanningServiceStop[],
): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  for (const [index, service] of serviceStops.entries()) {
    if (service.serviceSequenceNumber !== index + 1) {
      throw new Error(
        "Canonical service sequence must be contiguous before presentation.",
      );
    }

    (result[service.jobId] ??= []).push(service.serviceSequenceNumber);
  }

  return result;
}

export function buildPlanningDropMarkers(
  orderedVisits: FastPlotVisit[],
  serviceStops: PlanningServiceStop[],
): PlanningDropMarker[] {
  const dropsByVisit = orderedVisits.map(() => [] as number[]);

  for (const [index, service] of serviceStops.entries()) {
    if (service.serviceSequenceNumber !== index + 1) {
      throw new Error(
        "Canonical service sequence must be contiguous before presentation.",
      );
    }

    const visitIndex = service.visitSequenceNumber - 1;
    const visit = orderedVisits[visitIndex];

    if (!visit) {
      throw new Error(
        `Canonical Drop ${service.serviceSequenceNumber} references missing physical visit ${service.visitSequenceNumber}.`,
      );
    }

    dropsByVisit[visitIndex].push(service.serviceSequenceNumber);
  }

  return orderedVisits.flatMap((visit, index) => {
    const dropNumbers = dropsByVisit[index];

    if (dropNumbers.length === 0) {
      return [];
    }

    return [{
      position: visit.point,
      label: dropNumbers.join("/"),
    }];
  });
}
