// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import StopCard, { type Stop } from "../../app/jobs/StopCard";
import { saveStopPod } from "./savePod";

const fixture = vi.hoisted(() => ({ client: {} as any }));
vi.mock("../supabase/browser", () => ({ createClient: () => fixture.client }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => ({ activeTenantId: "tenant" }) }));

let root: Root;
let container: HTMLDivElement;
let stop: Stop;
let evidence: any[];
let uploads: File[];
let writes: { table: string; tenant: string | null; body: any }[];
let releaseAuth: () => void;
let markDelivered: Mock<(stopId: string) => Promise<boolean>>;
let uploadError: string | null;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  stop = { id: "stop", stop_order: 2, type: "delivery", address_line: "Test depot", city: "Test", postcode: "TE1 1ST",
    contact_name: null, contact_phone: null, contact_email: null, status: "pending", pod_status: "pending",
    recipient_name: "Test Recipient", delivered_at: null, collected_at: null, pod_notes: "", pod_photo_url: null };
  evidence = []; uploads = []; writes = []; uploadError = null;
  const auth = new Promise<void>((resolve) => { releaseAuth = resolve; });
  fixture.client = {
    auth: { getUser: async () => { await auth; return { data: { user: { id: "office" } }, error: null }; } },
    from: () => ({ select: () => ({ eq() { return this; }, order: async () => ({ data: [...evidence], error: null }) }) }),
    storage: { from: () => ({ uploadToSignedUrl: async (_path: string, _token: string, file: File) => {
      if (uploadError) return { error: { message: uploadError } };
      uploads.push(file); return { error: null };
    } }) },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/upload-url")) return Response.json({ path: "tenant/job/stop/fixture", token: "test" });
    if (url === "/api/pod/evidence") {
      const row = { id: `evidence-${evidence.length}`, tenant_id: "tenant", job_id: "job", stop_id: "stop",
        evidence_type: body.evidenceType, storage_path: body.storagePath, original_filename: body.originalFilename,
        mime_type: body.mimeType, file_size_bytes: uploads.at(-1)?.size, created_at: new Date().toISOString() };
      evidence.push(row); return Response.json({ ok: true, evidence: row });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  // Exercise the real save client and its tenant-scoped requests, without any network.
  const client = createClient("https://fixture.invalid", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      writes.push({ table: url.pathname, tenant: url.searchParams.get("tenant_id"), body });
      if (url.pathname.endsWith("/job_stops")) Object.assign(stop, body);
      return Response.json([{ id: url.pathname.endsWith("/jobs") ? "job" : "stop" }]);
    }
    return Response.json(url.pathname.endsWith("/jobs") ? { id: "job", status: "planned" } : [stop]);
  } } });
  markDelivered = vi.fn(async () => {
    await saveStopPod(client, { tenantId: "tenant", jobId: "job", stopId: "stop", stopType: "delivery",
      recipientName: "Test Recipient", podNotes: "Test delivery", markComplete: true });
    return true;
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(createElement(StopCard, { jobId: "job", tenantId: "tenant", stop,
    podForm: undefined, onPodFieldChange: () => {}, onMarkDelivered: markDelivered, onMarkCollected: async () => false })));
}
async function selectFile(index: number, file: File) {
  const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[index];
  // Browser FileLists are live: resetting the picker clears the selection while
  // getUser is still pending. Model that behaviour explicitly in the DOM test.
  const liveFiles = [file];
  Object.defineProperty(input, "files", { configurable: true, get: () => liveFiles });
  Object.defineProperty(input, "value", { configurable: true, set: () => { liveFiles.length = 0; }, get: () => "" });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(liveFiles).toHaveLength(0);
  expect(uploads).toHaveLength(0);
  await act(async () => { releaseAuth(); });
}
async function deliver() {
  const button = [...container.querySelectorAll("button")].find((el) => el.textContent === "Mark Delivered")!;
  await act(async () => button.click());
}

describe("job card evidence upload and delivery completion", () => {
  it.each([
    [0, "camera.jpg", "image/jpeg"], [1, "photo.png", "image/png"], [2, "pod.pdf", "application/pdf"],
  ])("keeps picker %i's selected file through async auth, then saves delivery with that file alone", async (index, name, type) => {
    await render();
    const file = new File(["fixture evidence bytes"], name, { type });
    await selectFile(index, file);
    expect(uploads).toEqual([file]);
    expect(await uploads[0].text()).toBe("fixture evidence bytes");
    expect(evidence).toHaveLength(1);
    expect(container.textContent).toContain(name);
    await deliver();
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(2);
    expect(writes.every((write) => write.tenant === "eq.tenant")).toBe(true);
    expect(writes[0].body.pod_status).toBe("delivered");
    expect(writes[1].body.status).toBe("completed");
  });
  it("accepts an existing POD document without requesting another photo", async () => {
    stop.pod_document_url = "tenant/job/stop/documents/legacy.pdf";
    await render(); await deliver();
    expect(container.textContent).toContain("View POD document");
    expect(writes).toHaveLength(2);
  });
  it("keeps delivery pending when no evidence was uploaded", async () => {
    await render(); await deliver();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add one delivery photo or POD document");
    expect(writes).toHaveLength(0);
  });
  it("reports an upload failure without a false success or completion", async () => {
    uploadError = "Synthetic storage failure";
    await render(); await selectFile(1, new File(["bytes"], "photo.jpg", { type: "image/jpeg" }));
    expect(container.textContent).toContain("The file upload did not complete");
    expect(container.textContent).not.toContain("Photo saved");
    expect(evidence).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});
