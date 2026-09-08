import { describe, expect, it } from "vitest";
import { planningMapMarkerPresentation } from "./mapPresentation";

describe("planningMapMarkerPresentation", () => {
  it("keeps a single Drop number unchanged", () => {
    expect(planningMapMarkerPresentation("17")).toEqual({
      text: "17",
      title: null,
    });
  });

  it("keeps a two-Drop shared location compact", () => {
    expect(planningMapMarkerPresentation("17/18")).toEqual({
      text: "17/18",
      title: null,
    });
  });

  it("compacts a large shared-location Drop list", () => {
    expect(
      planningMapMarkerPresentation("95/96/97/98/99")
    ).toEqual({
      text: "95+4",
      title: "Drops 95, 96, 97, 98, 99",
    });
  });

  it("ignores empty slash segments when counting", () => {
    expect(
      planningMapMarkerPresentation("95//96/97/")
    ).toEqual({
      text: "95+2",
      title: "Drops 95, 96, 97",
    });
  });
});
