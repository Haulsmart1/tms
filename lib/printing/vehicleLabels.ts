import {
  buildSerializedBoxes,
  resolveStopSelection,
  type LabelJobItem,
  type LabelStop,
  type SerializedBox,
} from "./jobLabels";

export type VehicleLabelJob = {
  id: string;
  reference: string | null;
  stops: LabelStop[];
  items: LabelJobItem[];
};

export type VehicleLabel = {
  key: string;
  jobId: string;
  jobReference: string;
  box: SerializedBox;
  boxNumber: number;
  totalJobBoxes: number;
  collection: LabelStop;
  delivery: LabelStop;
};

export type VehicleLabelBuildResult = {
  labels: VehicleLabel[];
  errors: string[];
};

export type VehicleLabelStopSelections = Record<
  string,
  {
    collectionId?: string;
    deliveryId?: string;
  }
>;

export function buildVehicleLabels(
  jobs: VehicleLabelJob[],
  stopSelections: VehicleLabelStopSelections = {},
): VehicleLabelBuildResult {
  const labels: VehicleLabel[] = [];
  const errors: string[] = [];
  const serialOwners = new Map<string, string>();

  for (const job of jobs) {
    const jobReference = String(job.reference ?? job.id).trim();
    const serialized = buildSerializedBoxes(job.items);

    if (serialized.boxes.length === 0) {
      errors.push(`${jobReference}: no serialized boxes.`);
      continue;
    }

    if (serialized.duplicateSerials.length > 0) {
      errors.push(
        `${jobReference}: duplicate serials across job items: ${
          serialized.duplicateSerials.join(", ")
        }.`,
      );
    }

    const requestedStops = stopSelections[job.id] ?? {};
    const selection = resolveStopSelection(
      job.stops,
      requestedStops.collectionId,
      requestedStops.deliveryId,
    );

    if (!selection.collection) {
      errors.push(
        `${jobReference}: multiple or missing collection addresses.`,
      );
    }

    if (!selection.delivery) {
      errors.push(
        `${jobReference}: multiple or missing delivery addresses.`,
      );
    }

    for (const box of serialized.boxes) {
      const previousOwner = serialOwners.get(box.serial);

      if (previousOwner && previousOwner !== job.id) {
        errors.push(
          `Barcode ${box.serial} is duplicated between ${previousOwner} and ${jobReference}.`,
        );
      } else {
        serialOwners.set(box.serial, job.id);
      }
    }

    if (!selection.collection || !selection.delivery) {
      continue;
    }

    serialized.boxes.forEach((box, index) => {
      labels.push({
        key: `${job.id}:${box.jobItemId}:${box.serial}`,
        jobId: job.id,
        jobReference,
        box,
        boxNumber: index + 1,
        totalJobBoxes: serialized.boxes.length,
        collection: selection.collection!,
        delivery: selection.delivery!,
      });
    });
  }

  return {
    labels,
    errors: Array.from(new Set(errors)),
  };
}
