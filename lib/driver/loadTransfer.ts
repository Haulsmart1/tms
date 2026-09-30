import {
  normalizeScannedSerial,
  type SerializedJobItem,
} from "./barcode";

export type LoadTransferSerializedItem = {
  jobId: string;
  jobItemId: string;
  serialNumber: string;
};

export type LoadTransferInput = {
  sourceVehicleId: string;
  destinationVehicleId: string;
  destinationDriverId: string | null;
  items: LoadTransferSerializedItem[];
};

export type LoadTransferScanInput = {
  sourceVehicleId: string;
  destinationVehicleId: string;
  destinationDriverId: string | null;
  scannedValues: string[];
};

export type LoadTransferCandidateItem =
  SerializedJobItem & {
    job_id: string;
  };

export type LoadTransferScanResolution =
  | {
      ok: true;
      items: LoadTransferSerializedItem[];
    }
  | {
      ok: false;
      reason:
        | "invalid"
        | "unknown"
        | "ambiguous"
        | "duplicate";
      message: string;
      scannedValue?: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_LOAD_TRANSFER_ITEMS = 1000;

function requireObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function requireUuid(
  value: unknown,
  message: string,
): string {
  if (
    typeof value !== "string"
    || !UUID_PATTERN.test(value.trim())
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function optionalUuid(
  value: unknown,
  message: string,
): string | null {
  if (
    value === undefined
    || value === null
    || value === ""
  ) {
    return null;
  }

  return requireUuid(value, message);
}

function requireDifferentVehicles(
  sourceVehicleId: string,
  destinationVehicleId: string,
): void {
  if (sourceVehicleId === destinationVehicleId) {
    throw new Error(
      "Source and destination vehicles must differ.",
    );
  }
}

export function parseLoadTransferInput(
  value: unknown,
): LoadTransferInput {
  const body = requireObject(
    value,
    "Invalid load transfer request.",
  );

  const sourceVehicleId = requireUuid(
    body.sourceVehicleId,
    "A valid source vehicle is required.",
  );

  const destinationVehicleId = requireUuid(
    body.destinationVehicleId,
    "A valid destination vehicle is required.",
  );

  const destinationDriverId = optionalUuid(
    body.destinationDriverId,
    "A valid destination driver is required.",
  );

  requireDifferentVehicles(
    sourceVehicleId,
    destinationVehicleId,
  );

  if (!Array.isArray(body.items)) {
    throw new Error(
      "A load transfer requires serialized items.",
    );
  }

  if (body.items.length === 0) {
    throw new Error(
      "A load transfer requires at least one serialized item.",
    );
  }

  if (body.items.length > MAX_LOAD_TRANSFER_ITEMS) {
    throw new Error(
      `A load transfer cannot contain more than ${MAX_LOAD_TRANSFER_ITEMS} serialized items.`,
    );
  }

  const seen = new Set<string>();

  const items = body.items.map(
    (
      rawItem,
      index,
    ): LoadTransferSerializedItem => {
      const item = requireObject(
        rawItem,
        `Transfer item ${index + 1} is invalid.`,
      );

      const jobId = requireUuid(
        item.jobId,
        `Transfer item ${index + 1} has an invalid job.`,
      );

      const jobItemId = requireUuid(
        item.jobItemId,
        `Transfer item ${index + 1} has an invalid job item.`,
      );

      const serial =
        normalizeScannedSerial(
          item.serialNumber,
        );

      if (!serial.ok) {
        throw new Error(
          `Transfer item ${index + 1}: ${serial.message}`,
        );
      }

      const identity =
        `${jobItemId}\u0000${serial.value}`;

      if (seen.has(identity)) {
        throw new Error(
          "The transfer contains a duplicate serialized item.",
        );
      }

      seen.add(identity);

      return {
        jobId,
        jobItemId,
        serialNumber: serial.value,
      };
    },
  );

  return {
    sourceVehicleId,
    destinationVehicleId,
    destinationDriverId,
    items,
  };
}

export function parseLoadTransferScanInput(
  value: unknown,
): LoadTransferScanInput {
  const body = requireObject(
    value,
    "Invalid load transfer request.",
  );

  const sourceVehicleId = requireUuid(
    body.sourceVehicleId,
    "A valid source vehicle is required.",
  );

  const destinationVehicleId = requireUuid(
    body.destinationVehicleId,
    "A valid destination vehicle is required.",
  );

  const destinationDriverId = optionalUuid(
    body.destinationDriverId,
    "A valid destination driver is required.",
  );

  requireDifferentVehicles(
    sourceVehicleId,
    destinationVehicleId,
  );

  if (!Array.isArray(body.scannedValues)) {
    throw new Error(
      "A load transfer requires scanned barcodes or serial numbers.",
    );
  }

  if (body.scannedValues.length === 0) {
    throw new Error(
      "Scan at least one barcode or serial number.",
    );
  }

  if (
    body.scannedValues.length >
    MAX_LOAD_TRANSFER_ITEMS
  ) {
    throw new Error(
      `A load transfer cannot contain more than ${MAX_LOAD_TRANSFER_ITEMS} scanned items.`,
    );
  }

  const seen = new Set<string>();

  const scannedValues =
    body.scannedValues.map(
      (rawValue, index) => {
        const serial =
          normalizeScannedSerial(rawValue);

        if (!serial.ok) {
          throw new Error(
            `Scan ${index + 1}: ${serial.message}`,
          );
        }

        if (seen.has(serial.value)) {
          throw new Error(
            `Duplicate scan: ${serial.value}.`,
          );
        }

        seen.add(serial.value);

        return serial.value;
      },
    );

  return {
    sourceVehicleId,
    destinationVehicleId,
    destinationDriverId,
    scannedValues,
  };
}

/*
 * Resolve raw scanner values across the tenant's serialized job items.
 *
 * A serial must identify exactly one physical job item. We deliberately
 * refuse ambiguity instead of choosing an arbitrary job/item.
 */
export function resolveLoadTransferScans(
  scannedValues: readonly string[],
  candidates: readonly LoadTransferCandidateItem[],
): LoadTransferScanResolution {
  const resolved: LoadTransferSerializedItem[] = [];
  const identities = new Set<string>();

  for (const rawValue of scannedValues) {
    const scanned =
      normalizeScannedSerial(rawValue);

    if (!scanned.ok) {
      return {
        ok: false,
        reason: "invalid",
        message: scanned.message,
      };
    }

    const matches: LoadTransferSerializedItem[] = [];

    for (const candidate of candidates) {
      for (
        const expectedRaw of
        candidate.serial_numbers ?? []
      ) {
        const expected =
          normalizeScannedSerial(
            expectedRaw,
          );

        if (
          expected.ok
          && expected.value === scanned.value
        ) {
          matches.push({
            jobId: candidate.job_id,
            jobItemId: candidate.id,
            serialNumber: expected.value,
          });

          break;
        }
      }
    }

    if (matches.length === 0) {
      return {
        ok: false,
        reason: "unknown",
        scannedValue: scanned.value,
        message:
          `Unknown barcode or serial number: ${scanned.value}.`,
      };
    }

    if (matches.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        scannedValue: scanned.value,
        message:
          `Serial number ${scanned.value} is attached to more than one job item. Correct the job data before transferring it.`,
      };
    }

    const match = matches[0];
    const identity =
      `${match.jobItemId}\u0000${match.serialNumber}`;

    if (identities.has(identity)) {
      return {
        ok: false,
        reason: "duplicate",
        scannedValue: scanned.value,
        message:
          `Duplicate scan: ${scanned.value}.`,
      };
    }

    identities.add(identity);
    resolved.push(match);
  }

  return {
    ok: true,
    items: resolved,
  };
}