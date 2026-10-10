import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const buckets = new Map<string, Map<string, Response>>();
  const key = (input: string | Request) => typeof input === "string" ? new URL(input, "https://tms.test").href : input.url;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>driver shell</html>", { headers: { "content-type": "text/html" } }));
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: async (name: string) => buckets.delete(name),
    match: async (input: string | Request, options: { cacheName: string }) => buckets.get(options.cacheName)?.get(key(input))?.clone(),
    open: async (name: string) => {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const bucket = buckets.get(name)!;
      return {
        put: async (input: string | Request, response: Response) => { bucket.set(key(input), response.clone()); },
        delete: async (input: string | Request) => bucket.delete(key(input)),
        keys: async () => [...bucket.keys()].map((url) => new Request(url)),
        addAll: async (paths: string[]) => { for (const path of paths) bucket.set(key(path), await fetcher(path)); },
      };
    },
  };
  const claim = vi.fn();
  runInNewContext(readFileSync(new URL("../../public/driver/sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), location: { origin: "https://tms.test" }, clients: { claim } },
    caches, fetch: fetcher, URL, Response,
  });
  async function dispatch(name: string, values: object) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(name)!({ ...values, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
    const result = await response;
    await Promise.all(waits);
    return result;
  }
  const navigate = (path: string, extra = {}) => dispatch("fetch", { request: { url: key(path), method: "GET", mode: "navigate", ...extra } });
  return { dispatch, navigate, fetcher, caches, buckets, claim };
}
describe("Driver service worker", () => {
  it("reopens a prepared dashboard when the network disappears", async () => {
    const w = worker();
    await w.dispatch("install", {});
    await w.navigate("/driver/dashboard");
    w.fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await w.navigate("/driver/dashboard"))!.text()).toContain("driver shell");
  });
  it("prepares job HTML and its JS/CSS on the first visit before SW control", async () => {
    const w = worker();
    w.fetcher.mockImplementation(async (path) => new Response(String(path).includes("/_next/") ? "asset" : '<html><script src="/_next/static/job.js"></script><link href="/_next/static/app.css"></html>', { headers: { "content-type": "text/html" } }));
    await w.dispatch("message", { data: { type: "PREPARE_DRIVER_PAGES", paths: ["/driver/jobs/job-1"] } });
    expect(await (await w.caches.match("/_next/static/job.js", { cacheName: "tms-driver-v1-assets" }))!.text()).toBe("asset");
    w.fetcher.mockRejectedValue(new Error("offline"));
    expect(await (await w.navigate("/driver/jobs/job-1"))!.text()).toContain("job.js");
  });
  it("uses a clear fallback for an unprepared offline page", async () => {
    const w = worker();
    await w.dispatch("install", {});
    w.fetcher.mockRejectedValue(new Error("offline"));
    expect(await w.navigate("/driver/jobs/missing")).toBeDefined();
  });
  it("honours login redirects and removes previously saved HTML", async () => {
    const w = worker();
    await w.dispatch("install", {});
    await w.navigate("/driver/dashboard");
    const login = new Response("login");
    Object.defineProperty(login, "redirected", { value: true });
    w.fetcher.mockResolvedValueOnce(login);
    expect(await (await w.navigate("/driver/dashboard"))!.text()).toBe("login");
    expect(await w.caches.match("/driver/dashboard", { cacheName: "tms-driver-v1-documents" })).toBeUndefined();
  });
  it.each(["/api/driver/me", "/api/driver/shift/events", "/dashboard", "/login", "https://other.test/driver/dashboard"])("does not intercept API, office or external request %s", async (path) => {
    const w = worker();
    expect(await w.navigate(path)).toBeUndefined();
    expect(w.fetcher).not.toHaveBeenCalled();
  });
  it("does not intercept mutations or Next RSC requests", async () => {
    const w = worker();
    expect(await w.navigate("/driver/dashboard", { method: "POST" })).toBeUndefined();
    expect(await w.navigate("/driver/dashboard?_rsc=abc", { mode: "cors" })).toBeUndefined();
  });
  it("rejects warming paths outside the driver document allowlist", async () => {
    const w = worker();
    await w.dispatch("message", { data: { type: "PREPARE_DRIVER_PAGES", paths: ["/api/driver/me", "/dashboard", "https://other.test/driver/dashboard"] } });
    expect(w.fetcher).not.toHaveBeenCalled();
  });
  it("cleans up only obsolete driver caches on activation", async () => {
    const w = worker();
    await w.caches.open("tms-driver-old-documents");
    await w.caches.open("unrelated-app");
    await w.dispatch("activate", {});
    expect([...w.buckets.keys()]).toEqual(["unrelated-app"]);
    expect(w.claim).toHaveBeenCalledOnce();
  });
});
