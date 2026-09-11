import { describe, expect, it } from "vitest";
import { planningMapMarkerPresentation } from "./mapPresentation";

describe("planningMapMarkerPresentation", () => {
  it("keeps one Drop number unchanged", () => {
    expect(
      planningMapMarkerPresentation("17")
    ).toEqual({
      text: "17",
      title: null,
    });
  });

  it("shows a clean range for two contiguous shared Drops", () => {
    expect(
      planningMapMarkerPresentation("17/18")
    ).toEqual({
      text: "17?18",
      title: "Drops 17, 18",
    });
  });

  it("shows a count for two non-contiguous shared Drops", () => {
    expect(
      planningMapMarkerPresentation("95/67")
    ).toEqual({
      text: "2 drops",
      title: "Drops 95, 67",
    });
  });

  it("shows a range for many contiguous shared Drops", () => {
    expect(
      planningMapMarkerPresentation("95/96/97/98/99")
    ).toEqual({
      text: "95?99",
      title: "Drops 95, 96, 97, 98, 99",
    });
  });

  it("never renders the historical first-plus-count marker", () => {
    const label = Array.from(
      { length: 68 },
      (_, index) => String(95 + index)
    ).join("/");

    const presentation =
      planningMapMarkerPresentation(label);

    expect(presentation.text).toBe("95?162");
    expect(presentation.text).not.toContain("+");
  });

  it("shows only a count for many non-contiguous Drops", () => {
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
      text: "95?97",
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

  it("does not invent a range for descending Drop numbers", () => {
    expect(
      planningMapMarkerPresentation("95/94")
    ).toEqual({
      text: "2 drops",
      title: "Drops 95, 94",
    });
  });
});
