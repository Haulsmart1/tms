import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrintedBoxLabel from "../../components/printing/PrintedBoxLabel";
import { BOX_LABEL_TEMPLATES } from "./labelTemplates";

const collection = {
  id: "collection",
  stop_order: 1,
  type: "collection" as const,
  contact_name: "Alex Collector",
  contact_phone: "+447700900123",
  address_line: "10 Example Street",
  city: "Example Town",
  postcode: "AB1 2CD",
};

const delivery = {
  ...collection,
  id: "delivery",
  stop_order: 2,
  type: "delivery" as const,
  contact_name: "Warehouse Contact",
  contact_phone: "+447700900456",
  address_line: "20 Delivery Road",
};

const box = {
  jobItemId: "item",
  serial: "FD C10931 1609 0123",
  sku: null,
  description: null,
  externalReference: null,
};

describe("printed box label", () => {
  it.each(BOX_LABEL_TEMPLATES)("prints collection contacts and the unchanged serial on $name", (template) => {
    const markup = renderToStaticMarkup(createElement(PrintedBoxLabel, {
      box, boxNumber: 1, totalBoxes: 1, jobReference: "RTNMUK00001",
      collection, delivery, widthMm: template.labelWidthMm, heightMm: template.labelHeightMm,
      leftMm: 0, topMm: 0,
    }));
    expect(markup).toContain("Alex Collector");
    expect(markup).toContain("+447700900123");
    expect(markup).toContain("10 Example Street, Example Town, AB1 2CD");
    expect(markup).toContain("20 Delivery Road, Example Town, AB1 2CD");
    expect(markup).toContain(`aria-label="Barcode ${box.serial}"`);
    expect(markup).toContain(`>${box.serial}</div>`);
    expect(markup).not.toContain("Warehouse Contact");
    expect(markup).not.toContain("+447700900456");
  });

  it("shows missing contact fields explicitly without substituting the delivery contact", () => {
    const markup = renderToStaticMarkup(createElement(PrintedBoxLabel, {
      box, boxNumber: 1, totalBoxes: 1, jobReference: "RTNMUK00001",
      collection: { ...collection, contact_name: null, contact_phone: null },
      delivery, widthMm: 63.5, heightMm: 33.9, leftMm: 0, topMm: 0,
    }));
    expect(markup).toContain("<strong>NAME:</strong> Not recorded");
    expect(markup).toContain("<strong>TEL:</strong> Not recorded");
    expect(markup).not.toContain("Warehouse Contact");
  });
});
