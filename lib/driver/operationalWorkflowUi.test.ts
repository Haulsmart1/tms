import { createElement } from "react";
// @ts-ignore TS7016: renderer declarations are not installed in the application.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BarcodeVerification from "../../app/driver/jobs/[jobId]/BarcodeVerification";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../../app/driver/driverQueue", () => ({ enqueuePodScan: mocks.enqueue }));
vi.mock("../../app/driver/jobs/[jobId]/CameraBarcodeScanner", () => ({
  default: () => createElement("button", { type: "button" }, "Camera control"),
}));

const item = {
  id: "item-1", sku: "SPEAKER", description: "Studio speaker", quantity: 3,
  serial_numbers: ["SERIAL-A", "SERIAL-B", "SERIAL-C"], external_reference: null, notes: null,
};
const scan = {
  id: "scan-1", stop_id: "stop-1", job_item_id: item.id, serial_number: "SERIAL-A",
  scan_format: "manual", scanned_by: "driver-1", scanned_at: "2026-10-19T18:00:00Z",
};

function render(overrides: Partial<Parameters<typeof BarcodeVerification>[0]> = {}) {
  return renderToStaticMarkup(createElement(BarcodeVerification, {
    jobId: "job-1", stopId: "stop-1", items: [item], scans: [], allPendingScans: [], paused: null,
    ...overrides,
  }));
}

describe("driver barcode workflow UI", () => {
  it("distinguishes server evidence, queued evidence and an unmatched serial", () => {
    const html = render({ scans: [scan], allPendingScans: [{ job_item_id: item.id, serial_number: "SERIAL-B" }] });
    expect(html).toContain('value="2" max="3"');
    expect(html).toContain("2 / 3 matched");
    expect(html).toContain("Server recorded");
    expect(html).toContain("On phone · waiting to send");
    expect(html).toContain("Awaiting scan");
    expect(html).toContain("Only “Server recorded” confirms a scan has reached TMS.");
  });

  it("does not count a queued serial twice when the server also records it", () => {
    const html = render({ scans: [scan], allPendingScans: [{ job_item_id: item.id, serial_number: "SERIAL-A" }] });
    expect(html).toContain('value="1" max="3"');
    expect(html).not.toContain("On phone · waiting to send");
  });

  it("never labels a different item's identical serial as this item's server evidence", () => {
    const html = render({ scans: [{ ...scan, job_item_id: "another-item" }] });
    expect(html).toContain('value="0" max="3"');
    expect(html).not.toContain('>Server recorded<');
  });

  it("shows paused sending without claiming a queued scan is server accepted", () => {
    const html = render({ paused: "Sign in again to send.", allPendingScans: [{ job_item_id: item.id, serial_number: "SERIAL-B" }] });
    expect(html).toContain("Sending paused: Sign in again to send.");
    expect(html).toContain("do not clear site data");
    expect(html).toContain("On phone · waiting to send");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("renders accessible progress, manual help and mounted live regions", () => {
    const html = render();
    expect(html).toContain('aria-label="Item barcode verification"');
    expect(html).toContain('aria-describedby="barcode-help-stop-1"');
    expect(html).toContain('id="barcode-help-stop-1"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Camera control");
  });

  it("renders no scanner for jobs with no expected serials", () => {
    expect(render({ items: [{ ...item, serial_numbers: [] }] })).toBe("");
  });

  it("deduplicates expected serials, escapes their values and retains matching semantics", () => {
    const html = render({ items: [{ ...item, serial_numbers: ["  SERIAL-A  ", "SERIAL-A", "<bad>", ""] }] });
    expect(html).toContain('value="0" max="2"');
    expect(html).toContain("&lt;bad&gt;");
    expect(html).not.toContain("<bad>");
  });
});
