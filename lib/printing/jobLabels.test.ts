import {
  describe,
  expect,
  it,
} from "vitest";
import {
  DEFAULT_CUSTOM_TEMPLATE,
  templateCapacity,
  validateLabelTemplate,
} from "./labelTemplates";
import {
  buildSerializedBoxes,
  formatStopAddress,
  paginateLabels,
  resolveStopSelection,
} from "./jobLabels";

describe("job label helpers", () => {
  it("creates one box per unique serial within an item", () => {
    const result = buildSerializedBoxes([
      {
        id: "item-1",
        sku: "SKU-1",
        description: "Box",
        quantity: 3,
        serial_numbers: [
          "SER-1",
          " SER-1 ",
          "SER-2",
        ],
        external_reference: null,
        notes: null,
      },
    ]);

    expect(result.boxes.map((box) => box.serial)).toEqual([
      "SER-1",
      "SER-2",
    ]);

    expect(result.duplicateSerials).toEqual([]);
  });

  it("detects ambiguous serials across different items", () => {
    const result = buildSerializedBoxes([
      {
        id: "item-1",
        sku: null,
        description: null,
        quantity: 1,
        serial_numbers: ["DUP"],
        external_reference: null,
        notes: null,
      },
      {
        id: "item-2",
        sku: null,
        description: null,
        quantity: 1,
        serial_numbers: ["DUP"],
        external_reference: null,
        notes: null,
      },
    ]);

    expect(result.duplicateSerials).toEqual(["DUP"]);
  });

  it("automatically chooses a single collection and delivery", () => {
    const result = resolveStopSelection([
      {
        id: "c1",
        stop_order: 1,
        type: "collection",
        address_line: "Collection Road",
        city: "Leeds",
        postcode: "LS1 1AA",
      },
      {
        id: "d1",
        stop_order: 2,
        type: "delivery",
        address_line: "Delivery Road",
        city: "York",
        postcode: "YO1 1AA",
      },
    ]);

    expect(result.collection?.id).toBe("c1");
    expect(result.delivery?.id).toBe("d1");
    expect(result.requiresCollectionChoice).toBe(false);
    expect(result.requiresDeliveryChoice).toBe(false);
  });

  it("does not guess among multiple collection stops", () => {
    const result = resolveStopSelection([
      {
        id: "c1",
        stop_order: 1,
        type: "collection",
        address_line: "A",
        city: null,
        postcode: null,
      },
      {
        id: "c2",
        stop_order: 2,
        type: "collection",
        address_line: "B",
        city: null,
        postcode: null,
      },
      {
        id: "d1",
        stop_order: 3,
        type: "delivery",
        address_line: "C",
        city: null,
        postcode: null,
      },
    ]);

    expect(result.collection).toBeNull();
    expect(result.requiresCollectionChoice).toBe(true);
    expect(result.delivery?.id).toBe("d1");
  });

  it("formats addresses without empty fragments", () => {
    expect(
      formatStopAddress({
        id: "s1",
        stop_order: 1,
        type: "collection",
        address_line: "1 Road",
        city: null,
        postcode: "AB1 2CD",
      }),
    ).toBe("1 Road, AB1 2CD");
  });

  it("supports partially used sheets", () => {
    const template = {
      ...DEFAULT_CUSTOM_TEMPLATE,
      columns: 3,
      rows: 2,
    };

    const pages = paginateLabels(
      ["A", "B", "C"],
      template,
      3,
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([
      null,
      null,
      "A",
      "B",
      "C",
      null,
    ]);
  });

  it("paginates after the first partially used sheet", () => {
    const template = {
      ...DEFAULT_CUSTOM_TEMPLATE,
      columns: 2,
      rows: 2,
    };

    const pages = paginateLabels(
      ["A", "B", "C", "D"],
      template,
      3,
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([
      null,
      null,
      "A",
      "B",
    ]);
    expect(pages[1]).toEqual([
      "C",
      "D",
      null,
      null,
    ]);
  });

  it("rejects invalid start positions", () => {
    expect(() =>
      paginateLabels(
        ["A"],
        DEFAULT_CUSTOM_TEMPLATE,
        0,
      ),
    ).toThrow();
  });

  it("calculates template capacity", () => {
    expect(templateCapacity(DEFAULT_CUSTOM_TEMPLATE)).toBe(24);
  });

  it("rejects a custom layout wider than the page", () => {
    expect(
      validateLabelTemplate({
        ...DEFAULT_CUSTOM_TEMPLATE,
        labelWidthMm: 100,
        columns: 3,
      }),
    ).toBe("Labels exceed the printable page width.");
  });

  it("accepts the default custom layout", () => {
    expect(
      validateLabelTemplate(DEFAULT_CUSTOM_TEMPLATE),
    ).toBeNull();
  });
});
