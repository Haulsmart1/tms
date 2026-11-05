import { describe, expect, it } from "vitest";
import { buildCollectionEmail, collectionEmailOptionsError } from "./collectionEmail";

import { exampleJob, appointment } from "./collectionEmailFixtures";

describe("collection email contents", () => {
  it("uses the collection contact and includes date/window, full address, phone and serial", () => {
    const { preview, html } = buildCollectionEmail(exampleJob, appointment, "Example Carrier");
    expect(preview.email).toBe("collect@example.test");
    expect(preview.issue).toBeNull();
    expect(preview.text).toContain("Saturday, 7 November 2026 — AM (09:00–12:00, UK time)");
    expect(preview.text).toContain("1 Example Street, Example, AA1 1AA");
    expect(preview.text).toContain("01234 567890");
    expect(preview.text).toContain("FD C10931 0000 0001");
    expect(html).toContain("Test &lt;Contact&gt;");
    expect(html).not.toContain("Test <Contact>");
    expect(buildCollectionEmail(exampleJob, { ...appointment, window: "PM" }, "Carrier").preview.text).toContain("PM (12:00–17:00, UK time)");
  });
  it("does not send appointments for collected or completed jobs", () => {
    expect(buildCollectionEmail({ ...exampleJob, status: "completed" }, appointment, "Carrier").preview.issue).toContain("Already");
    const collected = structuredClone(exampleJob); collected.job_stops[0].status = "collected";
    expect(buildCollectionEmail(collected, appointment, "Carrier").preview.issue).toContain("Already");
  });
  it("does not fall back to a delivery contact or guess between collection stops", () => {
    const job = structuredClone(exampleJob); job.job_stops[0].contact_email = null;
    expect(buildCollectionEmail(job, appointment, "Carrier").preview.issue).toContain("Missing");
    job.job_stops.push({ ...exampleJob.job_stops[0], type: "delivery" });
    expect(buildCollectionEmail(job, appointment, "Carrier").preview.email).toBeNull();
    job.job_stops.push({ ...exampleJob.job_stops[0], id: "other" });
    expect(buildCollectionEmail(job, appointment, "Carrier").preview.issue).toContain("single");
  });
  it("uses the explicitly confirmed collection time on a receipt", () => {
    const result = buildCollectionEmail(exampleJob, { ...appointment, kind: "collection_receipt" }, "Carrier");
    expect(result.preview.text).toContain("Thursday, 5 November 2026 at 10:00");
    expect(result.preview.text).not.toContain("plans to collect");
    expect(exampleJob.status).toBe("planned");
  });
});
it("rejects invalid or past appointments and future receipts", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  expect(collectionEmailOptionsError(appointment, now)).toBeNull();
  expect(collectionEmailOptionsError({ ...appointment, date: "2026-02-30" }, now)).toContain("valid");
  expect(collectionEmailOptionsError({ ...appointment, date: "2026-11-04" }, now)).toContain("past");
  expect(collectionEmailOptionsError({ ...appointment, kind: "collection_receipt", collectedAt: "2026-11-06T12:00:00Z" }, now)).toContain("past");
});
