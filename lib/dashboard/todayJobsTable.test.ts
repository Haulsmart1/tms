import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TodayJobsTable, { type TodayJobRow } from "../../components/dashboard/TodayJobsTable";

const row: TodayJobRow = { id: "real-job-id", reference: "JOB-42", customerName: "Customer & Co", status: "pending_acceptance" };
const render = (state: "ready" | "error" | "empty" | "loading", rows = [row]) => renderToStaticMarkup(createElement(TodayJobsTable, { state, rows, onRetry: () => {} }));

describe("operational dashboard jobs table", () => {
  it("opens the actual job detail through a keyboard-accessible link", () => {
    const html = render("ready");
    expect(html).toContain('href="/jobs?job=real-job-id"');
    expect(html).toContain("JOB-42");
    expect(html).toContain("open job details");
    expect(html).not.toContain('role="button"');
  });
  it("encodes job identifiers rather than injecting query parameters", () => {
    const html = render("ready", [{ ...row, id: "job&other=1" }]);
    expect(html).toContain('href="/jobs?job=job%26other%3D1"');
  });
  it("labels recorded status without claiming a delivery was physically completed", () => {
    const html = render("ready");
    expect(html).toContain("Recorded status");
    expect(html).toContain("pending acceptance");
    expect(html).toContain("Customer &amp; Co");
    expect(html).not.toContain("delivered");
  });
  it("renders an actionable empty state, not fabricated rows", () => {
    const html = render("empty", []);
    expect(html).toContain("No jobs scheduled today");
    expect(html).toContain('href="/jobs"');
    expect(html).toContain("recorded completion evidence");
    expect(html).not.toContain("JOB-42");
  });
  it("hides stale rows on errors and provides the retry action", () => {
    const html = render("error");
    expect(html).toContain("Today&#x27;s jobs could not be loaded.");
    expect(html).toContain("Retry</button>");
    expect(html).not.toContain("JOB-42");
    expect(html).not.toContain("No jobs scheduled today");
  });
  it("does not render stale job data while loading", () => {
    const html = render("loading");
    expect(html).not.toContain("JOB-42");
    expect(html).not.toContain("No jobs scheduled today");
    expect(html).toContain("aria-hidden");
  });
});
