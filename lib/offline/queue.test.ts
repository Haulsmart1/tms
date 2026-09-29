import { describe, expect, it } from "vitest";
import { applyOutcome, classifySyncFailure, enqueue, nextDue, type QueueItem } from "./queue";

const now = 1_000_000;

describe("enqueue", () => {
  it("appends in order and ignores a duplicate id", () => {
    let q: QueueItem<string>[] = [];
    q = enqueue(q, "a", "A", now);
    q = enqueue(q, "b", "B", now);
    q = enqueue(q, "a", "A again", now);
    expect(q.map((i) => [i.id, i.payload])).toEqual([["a", "A"], ["b", "B"]]);
    expect(q[0]).toMatchObject({ attempts: 0, nextAttemptAt: now, lastError: null });
  });
});

describe("nextDue", () => {
  it("only ever offers the head of the queue, and only once it is due", () => {
    const q = enqueue(enqueue([], "a", 1, now), "b", 2, now);
    expect(nextDue(q, now)?.id).toBe("a");
    const waiting = [{ ...q[0], nextAttemptAt: now + 5000 }, q[1]];
    expect(nextDue(waiting, now)).toBeNull();
    expect(nextDue([], now)).toBeNull();
  });
});

describe("applyOutcome", () => {
  const q = enqueue(enqueue([], "a", 1, now), "b", 2, now);

  it("removes a sent item", () => {
    expect(applyOutcome(q, "a", { kind: "sent" }, now)).toEqual({ queue: [q[1]], rejected: null });
  });

  it("backs off a retry", () => {
    const r = applyOutcome(q, "a", { kind: "retry", error: "offline" }, now);
    expect(r.queue[0]).toMatchObject({ id: "a", attempts: 1, nextAttemptAt: now + 5000, lastError: "offline" });
    const r2 = applyOutcome(r.queue, "a", { kind: "retry", error: "offline" }, now);
    expect(r2.queue[0].nextAttemptAt).toBe(now + 10000);
  });

  it("removes a rejected item and hands it back so the driver can be told", () => {
    const r = applyOutcome(q, "a", { kind: "rejected", error: "Vehicle is off the road" }, now);
    expect(r.queue.map((i) => i.id)).toEqual(["b"]);
    expect(r.rejected).toMatchObject({ id: "a", lastError: "Vehicle is off the road" });
  });
});

describe("classifySyncFailure", () => {
  it("retries network and server trouble, stops on auth, rejects other 4xx", () => {
    expect(classifySyncFailure(null)).toBe("retry");
    expect(classifySyncFailure(503)).toBe("retry");
    expect(classifySyncFailure(429)).toBe("retry");
    expect(classifySyncFailure(401)).toBe("stop");
    expect(classifySyncFailure(403)).toBe("stop");
    expect(classifySyncFailure(409)).toBe("rejected");
    expect(classifySyncFailure(400)).toBe("rejected");
  });
});
