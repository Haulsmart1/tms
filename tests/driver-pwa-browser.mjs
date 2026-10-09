/* Local production-mode recovery regression, using headless Edge and CDP.
 * No npm/browser downloads, real credentials or production requests.
 * DRIVER_PWA_BUILD_DIR must point to a build using URL http://127.0.0.1:4319
 * and a dummy anon key. Run: node tests/driver-pwa-browser.mjs */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");
const buildDir = process.env.DRIVER_PWA_BUILD_DIR;
assert(buildDir, "Set DRIVER_PWA_BUILD_DIR to an isolated local production build (dummy Supabase URL/key).");
const origin = "http://127.0.0.1:4320";
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "driver@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const refs = ["RTNMUK10186", "RTNMUK10160", "RTNMUK10321", "RTNMUK09904", ...Array.from({ length: 21 }, (_, i) => `TEST${i}`)];
let jobs = refs.map((reference, route_order) => ({ id: `job-${route_order}`, reference, route_order, planning_date: date, job_date: "2020-01-01", scheduled_date: "2020-01-01", status: "planned", pod_status: null }));
const shift = { today: date, timeZone: "Europe/London", companyName: "Local test", onCallPhone: null, assignedVehicle: null, vehicles: [], catalogue: [], blockingCheck: null, syncPending: false,
  openShift: { id: "shift", clientId: "shift-client", startedAt: new Date().toISOString(), onBreak: false, breaks: [], currentVehicle: { vehicleId: "vehicle", registration: "HT21 EOR", startOdometer: 100, checkResult: "pass", checkPerformedAt: new Date().toISOString() } } };
let offline = false;
let next;
let edge;
let socket;
const mock = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  if (request.method === "OPTIONS") { response.end(); return; }
  if (request.url.startsWith("/modules/")) {
    const relative = decodeURIComponent(request.url.slice(9));
    const path = resolve(root, relative.endsWith(".ts") ? relative : `${relative}.ts`);
    if (!path.startsWith(join(root, "lib") + "/") && !path.startsWith(join(root, "lib") + "\\")) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", "text/javascript");
    response.end(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText);
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.url.startsWith("/auth/v1/user")) response.end(JSON.stringify(user));
  else if (request.url.includes("get_tenant_context")) response.end(JSON.stringify({ status: "ready", role: "staff", company_id: "tenant", home_tenant_id: "tenant", tenants: [{ id: "tenant", name: "Local test" }] }));
  else response.end("[]");
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, timeout = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await check()) return; } catch { /* document navigating */ } await pause(250); }
  if (socket?.readyState === WebSocket.OPEN) {
    console.error("Browser diagnostic:", await evaluate("JSON.stringify({url:location.href,text:document.body.innerText.slice(0,1800),controlled:!!navigator.serviceWorker.controller})").catch(String));
  }
  throw new Error(`Timed out: ${label}`);
}
async function startNext() {
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "-p", "4320"], { cwd: buildDir, windowsHide: true, stdio: "ignore", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4319", NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-driver-pwa-test-key" } });
  await until(async () => (await fetch(`${origin}/driver/manifest.webmanifest`)).ok, "local production server");
  console.log("Local production server ready.");
}
const pending = new Map();
let sequence = 0;
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function navigate(path) { await cdp("Page.navigate", { url: `${origin}${path}` }); }
function result(label) { console.log(`PASS ${label}`); }
try {
  await new Promise((r) => mock.listen(4319, "127.0.0.1", r));
  await startNext();
  edge = spawn(process.env.DRIVER_PWA_EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=9226", `--user-data-dir=${mkdtempSync(join(root, ".next", "driver-pwa-browser-"))}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  edge.stderr.on("data", (data) => process.stderr.write(data));
  let target;
  await until(async () => { target = (await (await fetch("http://127.0.0.1:9226/json", { signal: AbortSignal.timeout(2000) })).json()).find((x) => x.type === "page"); return target; }, "headless Edge");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener("open", r, { once: true }));
  socket.addEventListener("message", async ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message)); else call?.resolve(message.result);
    } else if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      if (offline) { await cdp("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" }).catch(() => {}); return; }
      const path = new URL(request.url).pathname;
      let body = {};
      if (path === "/api/driver/me") body = { driver: { id: userId, name: "Local Bob", active: true }, jobs, today: date, todayJobs: jobs, vehicleAssignments: [] };
      else if (path === "/api/driver/shift") body = shift;
      else if (path === "/api/driver/shift/events") {
        const event = JSON.parse(request.postData);
        if (event.type === "break_started") { shift.openShift.onBreak = true; shift.openShift.breaks.push({ startedAt: event.occurredAt, endedAt: null }); }
        else if (event.type === "break_ended") { shift.openShift.onBreak = false; for (const item of shift.openShift.breaks) if (!item.endedAt) item.endedAt = event.occurredAt; }
      } else if (/^\/api\/driver\/jobs\/[^/]+$/.test(path)) {
        const id = path.split("/").pop();
        body = { job: { id, reference: refs[Number(id.slice(4))], status: "planned", items: [], scans: [], stops: [{ id: "stop", stop_order: 1, type: "delivery", address_line: "Local test address", city: "Test", postcode: "TE1 1ST", status: "planned", evidence: [] }] } };
      }
      // Navigation can cancel an already-paused request.
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
    }
    else if (message.method === "Runtime.exceptionThrown") console.error("Browser exception:", message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: `${origin}/api/driver/*`, requestStage: "Request" }] });
  const base64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = `${base64({ alg: "HS256", typ: "JWT" })}.${base64({ sub: userId, aud: "authenticated", role: "authenticated", exp })}.local-test`;
  const session = { access_token: token, refresh_token: "local-refresh", token_type: "bearer", expires_at: exp, expires_in: 86400, user };
  await cdp("Network.setCookie", { name: "sb-127-auth-token", value: `base64-${base64(session)}`, url: origin, path: "/", sameSite: "Lax" });
  await navigate("/driver/dashboard");
  await until(async () => (await evaluate("document.body.innerText")).includes("25 jobs today"), "25-job dashboard");
  await until(async () => evaluate("document.querySelectorAll('a[href^=\"/driver/jobs/\"]').length >= 25"), "passing shift gate");
  const order = await evaluate("Array.from(document.querySelectorAll('a[href^=\"/driver/jobs/\"]')).map(a=>a.querySelector('strong')?.textContent.trim())");
  assert.deepEqual(order.slice(0, 4), refs.slice(0, 4)); result("25-job saved route and exact first-four order");
  await until(async () => evaluate("navigator.serviceWorker.controller !== null"), "SW controls page");
  await until(async () => evaluate("caches.open('tms-driver-v1-documents').then(c=>c.match(location.origin+'/driver/jobs/job-0')).then(Boolean)"), "job document prepared");
  await until(async () => evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('tms-driver-snapshots');r.onsuccess=()=>{const q=r.result.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>resolve(q.result.filter(x=>x.url.startsWith('/api/driver/jobs/')).length===25);q.onerror=()=>reject(q.error);};})"), "all assigned jobs durable");
  result("manifest/SW activation, prepared job documents and 25 durable job snapshots");
  offline = true; next.kill(); await pause(500);
  await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await navigate("/driver/dashboard");
  await until(async () => (await evaluate("document.body.innerText")).includes("25 jobs today"), "offline dashboard reopen");
  assert((await evaluate("document.body.innerText")).includes("Offline: showing data saved")); result("offline dashboard reload retains route and shows save time");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Start break').click()");
  await until(async () => (await evaluate("document.body.innerText")).includes("End break"), "offline break projected");
  await navigate("/driver/dashboard");
  await until(async () => (await evaluate("document.body.innerText")).includes("End break"), "queued break survives reload"); result("durable queue and shift projection survive offline reload");
  await navigate("/driver/jobs/job-0");
  await until(async () => (await evaluate("document.body.innerText")).includes("Local test address"), "offline job page"); result("prepared job opens offline with saved stop details");
  offline = false; await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await startNext(); await navigate("/driver/dashboard");
  await until(async () => evaluate("new Promise(resolve=>{const r=indexedDB.open('tms-driver-queue');r.onsuccess=()=>{const q=r.result.transaction('items').objectStore('items').getAll();q.onsuccess=()=>resolve(q.result.length===0);};})"), "queued break replayed");
  result("reconnect replays queued event and removes accepted queue row");
  jobs = []; await navigate("/driver/dashboard");
  await until(async () => (await evaluate("document.body.innerText")).includes("0 jobs today"), "new assignments replace cache");
  await until(async () => evaluate("new Promise(resolve=>{const r=indexedDB.open('tms-driver-snapshots');r.onsuccess=()=>{const q=r.result.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>resolve(q.result.every(x=>!x.url.startsWith('/api/driver/jobs/')));};})"), "removed assignment snapshots pruned");
  result("fresh empty route replaces old assignments and prunes cached job details");
  // Exercise the actual IDB adapter independently of UI timing, on local fixtures.
  const checks = await evaluate(`(async()=>{
    const {snapshotStore:s,reflectAcceptedShift:reflect}=await import('http://127.0.0.1:4319/modules/lib/offline/snapshotStore.ts');
    const state=${JSON.stringify(shift)};state.openShift.onBreak=false;state.openShift.breaks=[];
    await s.put({owner:'fixture',url:'/api/driver/shift',savedAt:100,data:state});
    await reflect('fixture',{type:'break_started',clientId:'accepted-break',shiftClientId:'shift-client',occurredAt:'2026-10-09T06:00:00Z'},200);
    const projected=await s.get('fixture','/api/driver/shift');
    if(!projected.data.openShift.onBreak||projected.reflectedAt!==201)throw Error('accepted state not durable');
    await reflect('fixture',{type:'break_started',clientId:'accepted-break',shiftClientId:'shift-client',occurredAt:'2026-10-09T06:00:00Z'},200);
    if((await s.get('fixture','/api/driver/shift')).data.openShift.breaks.length!==1)throw Error('duplicate accepted event');
    await s.put({owner:'fixture',url:'/api/driver/shift',savedAt:150,data:state});
    if(!(await s.get('fixture','/api/driver/shift')).data.openShift.onBreak)throw Error('overlapping server read lost accepted event');
    await s.put({owner:'fixture',url:'/api/driver/me',savedAt:500,data:{jobs:[]}});
    await s.put({owner:'fixture',url:'/api/driver/jobs/old',savedAt:400,data:{job:{id:'old'}}});
    if(await s.get('fixture','/api/driver/jobs/old'))throw Error('late prefetch revived removed job');
    await s.put({owner:'other',url:'/api/driver/me',savedAt:100,data:{jobs:[]}});
    await s.remove('fixture','/api/driver/me');
    if(await s.get('fixture','/api/driver/shift'))throw Error('access denial retained owner data');
    if(!await s.get('other','/api/driver/me'))throw Error('another owner was removed');
    return true;
  })()`);
  assert(checks); result("real IndexedDB: accepted events, duplicate protection, read races, revoked jobs and owner-scoped removal");
  // A cached HTML shell may be shared, but its account data must never be.
  offline = true; next.kill(); await pause(500);
  await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const aliceId = "22222222-2222-4222-8222-222222222222";
  const aliceToken = `${base64({ alg: "HS256", typ: "JWT" })}.${base64({ sub: aliceId, aud: "authenticated", role: "authenticated", exp })}.local-test`;
  await cdp("Network.setCookie", { name: "sb-127-auth-token", value: `base64-${base64({ ...session, access_token: aliceToken, user: { ...user, id: aliceId, email: "alice@example.test" } })}`, url: origin, path: "/", sameSite: "Lax" });
  await navigate("/driver/dashboard");
  await until(async () => (await evaluate("document.body.innerText")).includes("No saved data on this phone"), "other account cannot read Bob snapshots");
  assert(!(await evaluate("document.body.innerText")).includes("Local Bob"));
  result("account switch on a shared offline phone cannot reveal Bob's route");
  await cdp("Network.deleteCookies", { name: "sb-127-auth-token", url: origin });
  await navigate("/driver/dashboard");
  await until(async () => evaluate("document.body.innerText.includes('Connect and sign in') && localStorage.getItem('tms-driver-snapshot-owner') === null"), "signed-out cached shell and completed session read");
  assert.equal(await evaluate("localStorage.getItem('tms-driver-snapshot-owner')"), null);
  result("signed-out offline reopening hides driver data and forgets remembered account");
  console.log("All local Driver PWA browser recovery checks passed.");
} finally {
  socket?.close(); edge?.kill(); next?.kill(); mock.close();
}
