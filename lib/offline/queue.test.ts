import { describe, expect, it } from "vitest";
import { applyOutcome, classifySyncFailure, enqueue, nextDue, SERVER_SET_ASIDE_MESSAGE, type QueueItem } from "./queue";

const now = 1_000_000;

describe("enqueue", () => {
  it("appends in order and ignores a duplicate id", () => {
    let q: QueueItem<string>[] = [];
    q = enqueue(q, "a", "A", now);
    q = enqueue(q, "b", "B", now);
    q = enqueue(q, "a", "A again", now);
    expect(q.map((i) => [i.id, i.payload])).toEqual([["a", "A"], ["b", "B"]]);
    expect(q[0]).toMatchObject({ attempts: 0, serverFailures: 0, nextAttemptAt: now, lastError: null });
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

describe("server failures on the head item", () => {
  const q = enqueue(enqueue([], "a", 1, now), "b", 2, now);

  it("sets the item aside after five consecutive 5xx answers so the queue cannot wedge", () => {
    let queue = q;
    for (let i = 0; i < 4; i++) {
      const r = applyOutcome(queue, "a", { kind: "retry", error: "Unable to save. Try again.", status: 500 }, now);
      expect(r.rejected).toBeNull();
      queue = r.queue;
    }
    expect(queue[0]).toMatchObject({ id: "a", serverFailures: 4 });
    const fifth = applyOutcome(queue, "a", { kind: "retry", error: "Unable to save. Try again.", status: 503 }, now);
    expect(fifth.queue.map((i) => i.id)).toEqual(["b"]);
    expect(fifth.rejected).toMatchObject({ id: "a", lastError: SERVER_SET_ASIDE_MESSAGE });
    expect(SERVER_SET_ASIDE_MESSAGE).toBe("The server could not save this. It has been set aside; tell the office.");
  });

  it("only counts consecutive server failures: a network failure resets the count", () => {
    let queue = q;
    for (let i = 0; i < 4; i++) queue = applyOutcome(queue, "a", { kind: "retry", error: "x", status: 500 }, now).queue;
    queue = applyOutcome(queue, "a", { kind: "retry", error: "offline" }, now).queue;
    expect(queue[0]).toMatchObject({ serverFailures: 0 });
    const r = applyOutcome(queue, "a", { kind: "retry", error: "x", status: 500 }, now);
    expect(r.rejected).toBeNull();
  });

  it("never sets aside for rate limiting or timeouts", () => {
    let queue = q;
    for (let i = 0; i < 10; i++) queue = applyOutcome(queue, "a", { kind: "retry", error: "slow down", status: 429 }, now).queue;
    expect(queue[0]).toMatchObject({ id: "a", attempts: 10, serverFailures: 0 });
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
