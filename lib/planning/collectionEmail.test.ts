import { describe, expect, it } from "vitest";
import { buildCollectionEmail, collectionEmailOptionsError } from "./collectionEmail";

import { exampleJob, appointment, deliveryJob } from "./collectionEmailFixtures";

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

describe("collection and delivery appointment times", () => {
  const options = { ...appointment, stopType: "delivery" as const, window: "CUSTOM" as const, timeFrom: "14:30" };
  it("addresses a delivery appointment only to the delivery contact and address", () => {
    const { preview } = buildCollectionEmail(deliveryJob, options, "Carrier");
    expect(preview.issue).toBeNull();
    expect(preview.email).toBe("deliver@example.test");
    expect(preview.stopId).toBe(deliveryJob.job_stops[1].id);
    expect(preview.subject).toContain("Your delivery appointment");
    expect(preview.text).toContain("Delivery time: Saturday, 7 November 2026 — 14:30 (UK time)");
    expect(preview.text).toContain("Delivery address: 2 Delivery Road, Destination, BB2 2BB");
    expect(preview.text).not.toContain("1 Example Street");
    expect(preview.text).not.toContain("plans to collect");
    expect(buildCollectionEmail(deliveryJob, { ...options, timeTo: "16:00" }, "Carrier").preview.text).toContain("14:30–16:00 (UK time)");
    expect(buildCollectionEmail(deliveryJob, { ...options, stopType: "collection" }, "Carrier").preview.email).toBe("collect@example.test");
  });
  it("permits a delivery after collection, but blocks delivered jobs and missing delivery contacts", () => {
    const job = structuredClone(deliveryJob);
    job.job_stops[0].collected_at = "2026-11-05T10:00:00Z";
    expect(buildCollectionEmail(job, options, "Carrier").preview.issue).toBeNull();
    job.job_stops[1].delivered_at = "2026-11-05T11:00:00Z";
    expect(buildCollectionEmail(job, options, "Carrier").preview.issue).toContain("delivered");
    job.job_stops[1].delivered_at = null;
    job.job_stops[1].status = "delivered";
    expect(buildCollectionEmail(job, options, "Carrier").preview.issue).toContain("delivered");
    job.job_stops[1].contact_email = null;
    const preview = buildCollectionEmail(job, options, "Carrier").preview;
    expect(preview.email).toBeNull();
    expect(preview.issue).toContain("Missing or invalid delivery email");
  });
  it("validates specific times, same-day windows and the UK clock change", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(collectionEmailOptionsError(options, now)).toBeNull();
    for (const timeFrom of ["", "24:00", "13:60", "9:00"]) {
      expect(collectionEmailOptionsError({ ...options, timeFrom }, now)).toContain("valid");
    }
    for (const timeTo of ["14:00", "14:30", "25:00"]) {
      expect(collectionEmailOptionsError({ ...options, timeTo }, now)).toContain("later");
    }
    expect(collectionEmailOptionsError({ ...options, date: "2026-11-05", timeFrom: "11:00" }, now)).toContain("past");
    expect(collectionEmailOptionsError({ ...options, date: "2027-03-28", timeFrom: "01:30" }, now)).toContain("clocks change");
    // 12:30 UK in summer is 11:30 UTC, regardless of the server's locale.
    expect(collectionEmailOptionsError({ ...options, date: "2027-07-01", timeFrom: "12:30" }, new Date("2027-07-01T12:00:00Z"))).toContain("past");
    expect(collectionEmailOptionsError({ ...options, kind: "collection_receipt" }, now)).toContain("collection contact");
  });
});
it("rejects invalid or past appointments and future receipts", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  expect(collectionEmailOptionsError(appointment, now)).toBeNull();
  expect(collectionEmailOptionsError({ ...appointment, date: "2026-02-30" }, now)).toContain("valid");
  expect(collectionEmailOptionsError({ ...appointment, date: "2026-11-04" }, now)).toContain("past");
  expect(collectionEmailOptionsError({ ...appointment, kind: "collection_receipt", collectedAt: "2026-11-06T12:00:00Z" }, now)).toContain("past");
});
