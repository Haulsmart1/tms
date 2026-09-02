
export const MAX_SCANNED_SERIAL_LENGTH = 250;

export type SerializedJobItem = {
  id: string;
  serial_numbers: string[] | null;
};

export type JobItemScanLike = {
  job_item_id: string;
  serial_number: string;
  stop_id?: string | null;
};

export type ExpectedSerialMatch =
  | {
      ok: true;
      itemId: string;
      serialNumber: string;
    }
  | {
      ok: false;
      reason: "invalid" | "unknown" | "ambiguous";
      message: string;
    };

export type BarcodeProgress = {
  expected: number;
  verified: number;
  remaining: number;
};

export function normalizeScannedSerial(
  value: unknown,
):
  | {
      ok: true;
      value: string;
    }
  | {
      ok: false;
      message: string;
    } {
  if (typeof value !== "string") {
    return {
      ok: false,
      message: "A barcode or serial number is required.",
    };
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return {
      ok: false,
      message: "A barcode or serial number is required.",
    };
  }

  if (
    normalized.length >
    MAX_SCANNED_SERIAL_LENGTH
  ) {
    return {
      ok: false,
      message: "The scanned value is too long.",
    };
  }

  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    return {
      ok: false,
      message: "The scanned value contains unsupported characters.",
    };
  }

  return {
    ok: true,
    value: normalized,
  };
}

export function expectedSerialsForItem(
  item: SerializedJobItem,
): string[] {
  const result = new Set<string>();

  for (const serial of item.serial_numbers ?? []) {
    const normalized =
      normalizeScannedSerial(serial);

    if (normalized.ok) {
      result.add(normalized.value);
    }
  }

  return [...result];
}

export function findExpectedSerial(
  items: SerializedJobItem[],
  scannedValue: unknown,
): ExpectedSerialMatch {
  const scanned =
    normalizeScannedSerial(scannedValue);

  if (!scanned.ok) {
    return {
      ok: false,
      reason: "invalid",
      message: scanned.message,
    };
  }

  const matches = items.filter((item) =>
    expectedSerialsForItem(item).includes(
      scanned.value,
    ),
  );

  if (matches.length === 0) {
    return {
      ok: false,
      reason: "unknown",
      message:
        "This barcode or serial number is not expected on this job.",
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      message:
        "This serial number is attached to more than one item on this job. Ask the office to correct the job data.",
    };
  }

  return {
    ok: true,
    itemId: matches[0].id,
    serialNumber: scanned.value,
  };
}

export function barcodeProgress(
  items: SerializedJobItem[],
  scans: JobItemScanLike[],
): BarcodeProgress {
  const expectedKeys = new Set<string>();

  for (const item of items) {
    for (const serial of expectedSerialsForItem(item)) {
      expectedKeys.add(
        `${item.id}\u0000${serial}`,
      );
    }
  }

  const verifiedKeys = new Set<string>();

  for (const scan of scans) {
    const normalized =
      normalizeScannedSerial(
        scan.serial_number,
      );

    if (!normalized.ok) {
      continue;
    }

    const key =
      `${scan.job_item_id}\u0000${normalized.value}`;

    if (expectedKeys.has(key)) {
      verifiedKeys.add(key);
    }
  }

  const expected = expectedKeys.size;
  const verified = verifiedKeys.size;

  return {
    expected,
    verified,
    remaining:
      Math.max(0, expected - verified),
  };
}
