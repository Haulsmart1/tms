import {
  describe,
  expect,
  it,
} from "vitest";

import {
  currentManifestState,
  decideManifestAction,
  manifestBarcodeValue,
  manifestReference,
} from "./loadManifest";

describe("load manifest workflow", () => {
  it("creates a stable master barcode value", () => {
    expect(
      manifestBarcodeValue(
        "00000000-0000-4000-8000-000000000001",
      ),
    ).toBe(
      "TMSLOAD:00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects an empty barcode token", () => {
    expect(() => manifestBarcodeValue("   ")).toThrow(
      "A load manifest barcode token is required.",
    );
  });

  it("formats a friendly manifest reference", () => {
    expect(manifestReference(184)).toBe("ML-000184");
  });

  it("starts in not-loaded state", () => {
    expect(currentManifestState([])).toBe("not_loaded");
  });

  it("allows the first scan onto van", () => {
    expect(
      decideManifestAction([], "load"),
    ).toMatchObject({
      allowed: true,
      eventType: "loaded",
      state: "not_loaded",
    });
  });

  it("rejects scan off before scan on", () => {
    expect(
      decideManifestAction([], "unload"),
    ).toMatchObject({
      allowed: false,
      eventType: null,
      state: "not_loaded",
    });
  });

  it("rejects duplicate scan onto van", () => {
    expect(
      decideManifestAction(
        [{ event_type: "loaded" }],
        "load",
      ),
    ).toMatchObject({
      allowed: false,
      eventType: null,
      state: "loaded",
    });
  });

  it("allows scan off after scan on", () => {
    expect(
      decideManifestAction(
        [{ event_type: "loaded" }],
        "unload",
      ),
    ).toMatchObject({
      allowed: true,
      eventType: "unloaded",
      state: "loaded",
    });
  });

  it("rejects duplicate scan off", () => {
    expect(
      decideManifestAction(
        [
          { event_type: "loaded" },
          { event_type: "unloaded" },
        ],
        "unload",
      ),
    ).toMatchObject({
      allowed: false,
      eventType: null,
      state: "unloaded",
    });
  });

  it("allows a later transport leg", () => {
    expect(
      decideManifestAction(
        [
          { event_type: "loaded" },
          { event_type: "unloaded" },
        ],
        "load",
      ),
    ).toMatchObject({
      allowed: true,
      eventType: "loaded",
      state: "unloaded",
    });
  });
});
