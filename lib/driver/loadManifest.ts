export type LoadManifestEventType =
  | "loaded"
  | "unloaded";

export type LoadManifestState =
  | "not_loaded"
  | "loaded"
  | "unloaded";

export type LoadManifestAction =
  | "load"
  | "unload";

export type LoadManifestActionDecision = {
  allowed: boolean;
  state: LoadManifestState;
  eventType: LoadManifestEventType | null;
  message: string;
};

export type LoadManifestEvent = {
  event_type: LoadManifestEventType;
  scanned_at?: string;
};

export function manifestBarcodeValue(
  barcodeToken: string,
): string {
  const token = barcodeToken.trim();

  if (!token) {
    throw new Error(
      "A load manifest barcode token is required.",
    );
  }

  return `TMSLOAD:${token}`;
}

export function manifestReference(
  manifestNumber: number,
): string {
  if (
    !Number.isSafeInteger(manifestNumber)
    || manifestNumber <= 0
  ) {
    throw new Error(
      "Manifest number must be a positive integer.",
    );
  }

  return `ML-${String(manifestNumber).padStart(6, "0")}`;
}

export function currentManifestState(
  events: readonly LoadManifestEvent[],
): LoadManifestState {
  if (events.length === 0) {
    return "not_loaded";
  }

  const latest = events[events.length - 1];

  return latest.event_type === "loaded"
    ? "loaded"
    : "unloaded";
}

export function decideManifestAction(
  events: readonly LoadManifestEvent[],
  action: LoadManifestAction,
): LoadManifestActionDecision {
  const state = currentManifestState(events);

  if (action === "load") {
    if (state === "loaded") {
      return {
        allowed: false,
        state,
        eventType: null,
        message: "This load is already on the van.",
      };
    }

    return {
      allowed: true,
      state,
      eventType: "loaded",
      message: "Load can be scanned onto the van.",
    };
  }

  if (state === "not_loaded") {
    return {
      allowed: false,
      state,
      eventType: null,
      message:
        "This load has not been scanned onto the van.",
    };
  }

  if (state === "unloaded") {
    return {
      allowed: false,
      state,
      eventType: null,
      message:
        "This load has already been scanned off the van.",
    };
  }

  return {
    allowed: true,
    state,
    eventType: "unloaded",
    message: "Load can be scanned off the van.",
  };
}

export type LoadManifestCreateItemInput = {
  jobId: string;
  jobItemId: string;
  serialNumber: string;
};

export type LoadManifestCreateInput = {
  vehicleId: string;
  driverId: string;
  items: LoadManifestCreateItemInput[];
};

export type LoadManifestScanInput = {
  barcodeToken: string;
  action: LoadManifestAction;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_MANIFEST_ITEMS = 1000;

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

function optionalFiniteNumber(
  value: unknown,
  message: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "number"
    || !Number.isFinite(value)
  ) {
    throw new Error(message);
  }

  return value;
}

export function parseManifestBarcodeToken(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      "A valid load manifest barcode is required.",
    );
  }

  const barcode = value.trim();
  const prefix = "TMSLOAD:";

  if (!barcode.startsWith(prefix)) {
    throw new Error(
      "A valid load manifest barcode is required.",
    );
  }

  const token = barcode.slice(prefix.length).trim();

  if (!UUID_PATTERN.test(token)) {
    throw new Error(
      "A valid load manifest barcode is required.",
    );
  }

  return token;
}

export function parseLoadManifestCreateBody(
  value: unknown,
): LoadManifestCreateInput {
  const body = requireObject(
    value,
    "Invalid load manifest request.",
  );

  const vehicleId = requireUuid(
    body.vehicleId,
    "A valid vehicle is required.",
  );

  const driverId = requireUuid(
    body.driverId,
    "A valid driver is required.",
  );

  if (!Array.isArray(body.items)) {
    throw new Error(
      "A load manifest requires serialized items.",
    );
  }

  if (body.items.length === 0) {
    throw new Error(
      "A load manifest requires at least one serialized item.",
    );
  }

  if (body.items.length > MAX_MANIFEST_ITEMS) {
    throw new Error(
      `A load manifest cannot contain more than ${MAX_MANIFEST_ITEMS} serialized items.`,
    );
  }

  const seen = new Set<string>();

  const items = body.items.map(
    (rawItem, index): LoadManifestCreateItemInput => {
      const item = requireObject(
        rawItem,
        `Manifest item ${index + 1} is invalid.`,
      );

      const jobId = requireUuid(
        item.jobId,
        `Manifest item ${index + 1} has an invalid job.`,
      );

      const jobItemId = requireUuid(
        item.jobItemId,
        `Manifest item ${index + 1} has an invalid job item.`,
      );

      if (typeof item.serialNumber !== "string") {
        throw new Error(
          `Manifest item ${index + 1} requires a serial number.`,
        );
      }

      const serialNumber = item.serialNumber.trim();

      if (
        serialNumber.length === 0
        || serialNumber.length > 250
      ) {
        throw new Error(
          `Manifest item ${index + 1} has an invalid serial number.`,
        );
      }

      const key = `${jobItemId}\u0000${serialNumber}`;

      if (seen.has(key)) {
        throw new Error(
          "The manifest contains a duplicate serialized item.",
        );
      }

      seen.add(key);

      return {
        jobId,
        jobItemId,
        serialNumber,
      };
    },
  );

  return {
    vehicleId,
    driverId,
    items,
  };
}

export function parseLoadManifestScanBody(
  value: unknown,
): LoadManifestScanInput {
  const body = requireObject(
    value,
    "Invalid load manifest scan request.",
  );

  const barcodeToken =
    parseManifestBarcodeToken(body.barcode);

  if (
    body.action !== "load"
    && body.action !== "unload"
  ) {
    throw new Error(
      "Manifest action must be load or unload.",
    );
  }

  const latitude = optionalFiniteNumber(
    body.latitude,
    "Invalid GPS latitude.",
  );

  const longitude = optionalFiniteNumber(
    body.longitude,
    "Invalid GPS longitude.",
  );

  const accuracyM = optionalFiniteNumber(
    body.accuracyM,
    "Invalid GPS accuracy.",
  );

  if (
    latitude !== null
    && (latitude < -90 || latitude > 90)
  ) {
    throw new Error("Invalid GPS latitude.");
  }

  if (
    longitude !== null
    && (longitude < -180 || longitude > 180)
  ) {
    throw new Error("Invalid GPS longitude.");
  }

  if (accuracyM !== null && accuracyM < 0) {
    throw new Error("Invalid GPS accuracy.");
  }

  return {
    barcodeToken,
    action: body.action,
    latitude,
    longitude,
    accuracyM,
  };
}
