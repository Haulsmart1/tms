import { describe, it, expect } from "vitest";
import { routeNodes } from "./routeNodes";
import type { PodStop } from "./queue";

const stop = (over: Partial<PodStop>): PodStop => ({
  id: "s", stop_order: 1, type: "delivery", city: "X", postcode: "",
  pod_status: null, planned_at: null, delivered_at: null,
  pod_photo_url: null, pod_document_url: null,
  ...over,
});

describe("routeNodes", () => {
  it("marks delivered stops done and the focused stop current", () => {
    const stops = [
      stop({ id: "a", stop_order: 1, type: "collection", pod_status: "delivered" }),
      stop({ id: "b", stop_order: 2 }),
    ];
    expect(routeNodes(stops, "b", false)).toEqual({
      nodes: [
        { id: "a", state: "done" },
        { id: "b", state: "current" },
      ],
      arrowState: "pending",
    });
  });

  it("colours the arrowhead red when the focused stop is overdue", () => {
    const stops = [stop({ id: "a", stop_order: 1 })];
    expect(routeNodes(stops, "a", true).arrowState).toBe("overdue");
  });

  it("colours the arrowhead green once the focused stop is delivered", () => {
    const stops = [stop({ id: "a", stop_order: 1, pod_status: "delivered" })];
    expect(routeNodes(stops, "a", false).arrowState).toBe("delivered");
  });

  it("orders by stop_order regardless of input order", () => {
    const stops = [stop({ id: "b", stop_order: 2 }), stop({ id: "a", stop_order: 1 })];
    expect(routeNodes(stops, "b", false).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("handles a four-stop job", () => {
    const stops = [1, 2, 3, 4].map((i) =>
      stop({ id: `s${i}`, stop_order: i, pod_status: i <= 2 ? "delivered" : null }),
    );
    const { nodes } = routeNodes(stops, "s3", false);
    expect(nodes.map((n) => n.state)).toEqual(["done", "done", "current", "upcoming"]);
  });

  it("handles a single-stop job", () => {
    const { nodes, arrowState } = routeNodes([stop({ id: "only", stop_order: 1 })], "only", false);
    expect(nodes).toEqual([{ id: "only", state: "current" }]);
    expect(arrowState).toBe("pending");
  });

  it("marks a delivered focused stop done, not current, so the node and the arrow agree", () => {
    // Every row on the Completed tab focuses a delivered stop. Checking focused
    // before delivered made the node say in-progress while the arrow said
    // delivered.
    const stops = [
      stop({ id: "a", stop_order: 1, type: "collection", pod_status: "delivered" }),
      stop({ id: "b", stop_order: 2, pod_status: "delivered" }),
    ];
    const { nodes, arrowState } = routeNodes(stops, "b", false);
    expect(nodes).toEqual([
      { id: "a", state: "done" },
      { id: "b", state: "done" },
    ]);
    expect(arrowState).toBe("delivered");
  });

  it("still marks an undelivered focused stop current", () => {
    const stops = [
      stop({ id: "a", stop_order: 1, pod_status: "delivered" }),
      stop({ id: "b", stop_order: 2 }),
    ];
    expect(routeNodes(stops, "b", false).nodes[1]).toEqual({ id: "b", state: "current" });
  });
});
