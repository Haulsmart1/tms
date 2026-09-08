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

  it("shows a range for contiguous shared Drops", () => {
    expect(
      planningMapMarkerPresentation("95/96/97/98/99")
    ).toEqual({
      text: "95\u201399",
      title: "Drops 95, 96, 97, 98, 99",
    });
  });

  it("shows a count for non-contiguous shared Drops", () => {
    expect(
      planningMapMarkerPresentation("95/101/152")
    ).toEqual({
      text: "3 drops",
      title: "Drops 95, 101, 152",
    });
  });

  it("ignores empty slash segments when building a range", () => {
    expect(
      planningMapMarkerPresentation("95//96/97/")
    ).toEqual({
      text: "95\u201397",
      title: "Drops 95, 96, 97",
    });
  });

  it("does not invent a range for non-numeric labels", () => {
    expect(
      planningMapMarkerPresentation("95/A/97")
    ).toEqual({
      text: "3 drops",
      title: "Drops 95, A, 97",
    });
  });
});
