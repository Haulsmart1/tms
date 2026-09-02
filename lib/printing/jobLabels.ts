import {
  templateCapacity,
  type LabelTemplate,
} from "./labelTemplates";

export type LabelStop = {
  id: string;
  stop_order: number;
  type: "collection" | "delivery";
  address_line: string;
  city: string | null;
  postcode: string | null;
};

export type LabelJobItem = {
  id: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  serial_numbers: string[] | null;
  external_reference: string | null;
  notes: string | null;
};

export type SerializedBox = {
  jobItemId: string;
  serial: string;
  sku: string | null;
  description: string | null;
  externalReference: string | null;
};

export type StopSelection = {
  collection: LabelStop | null;
  delivery: LabelStop | null;
  requiresCollectionChoice: boolean;
  requiresDeliveryChoice: boolean;
};

export function buildSerializedBoxes(
  items: LabelJobItem[],
): {
  boxes: SerializedBox[];
  duplicateSerials: string[];
} {
  const boxes: SerializedBox[] = [];
  const seenAcrossItems = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    const itemSerials = new Set<string>();

    for (const rawSerial of item.serial_numbers ?? []) {
      const serial = String(rawSerial ?? "").trim();

      if (!serial || itemSerials.has(serial)) {
        continue;
      }

      itemSerials.add(serial);

      const previousItem = seenAcrossItems.get(serial);

      if (previousItem && previousItem !== item.id) {
        duplicates.add(serial);
      } else {
        seenAcrossItems.set(serial, item.id);
      }

      boxes.push({
        jobItemId: item.id,
        serial,
        sku: item.sku,
        description: item.description,
        externalReference: item.external_reference,
      });
    }
  }

  return {
    boxes,
    duplicateSerials: Array.from(duplicates).sort(),
  };
}

export function resolveStopSelection(
  stops: LabelStop[],
  collectionId?: string,
  deliveryId?: string,
): StopSelection {
  const ordered = [...stops].sort(
    (left, right) => left.stop_order - right.stop_order,
  );

  const collections = ordered.filter(
    (stop) => stop.type === "collection",
  );

  const deliveries = ordered.filter(
    (stop) => stop.type === "delivery",
  );

  const collection =
    collections.length === 1
      ? collections[0]
      : collections.find((stop) => stop.id === collectionId) ?? null;

  const delivery =
    deliveries.length === 1
      ? deliveries[0]
      : deliveries.find((stop) => stop.id === deliveryId) ?? null;

  return {
    collection,
    delivery,
    requiresCollectionChoice:
      collections.length !== 1 && collection === null,
    requiresDeliveryChoice:
      deliveries.length !== 1 && delivery === null,
  };
}

export function formatStopAddress(stop: LabelStop): string {
  return [
    stop.address_line,
    stop.city,
    stop.postcode,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function paginateLabels<T>(
  labels: T[],
  template: LabelTemplate,
  startPosition: number,
): Array<Array<T | null>> {
  const capacity = templateCapacity(template);

  if (
    !Number.isInteger(startPosition) ||
    startPosition < 1 ||
    startPosition > capacity
  ) {
    throw new Error(
      `Start position must be between 1 and ${capacity}.`,
    );
  }

  const slots: Array<T | null> = [
    ...Array.from(
      { length: startPosition - 1 },
      () => null,
    ),
    ...labels,
  ];

  const pages: Array<Array<T | null>> = [];

  for (let index = 0; index < slots.length; index += capacity) {
    const page = slots.slice(index, index + capacity);

    while (page.length < capacity) {
      page.push(null);
    }

    pages.push(page);
  }

  return pages.length > 0
    ? pages
    : [Array.from({ length: capacity }, () => null)];
}
