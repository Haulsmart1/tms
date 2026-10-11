import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Uses the installed Chromium browser and Node's WebSocket, no downloads.
// The profile and every artifact stay inside this worktree.
const origin = process.env.SEO_TEST_ORIGIN || "http://127.0.0.1:3107";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const executable = process.env.SEO_BROWSER_PATH || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
assert(executable, "Set SEO_BROWSER_PATH to an installed Chromium browser");
mkdirSync(".verification/seo-artifacts", { recursive: true });
const browser = spawn(executable, ["--headless=new", "--no-sandbox", "--remote-debugging-port=9317", `--user-data-dir=${resolve(".verification/seo-browser-profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
let commandId = 0;
const pending = new Map();
const handlers = new Map();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch("http://127.0.0.1:9317/json/new?about:blank", { method: "PUT" });
      target = await response.json();
      break;
    } catch { await delay(200); }
  }
  assert(target?.webSocketDebuggerUrl, "Browser debugging endpoint unavailable");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    if (value.id) {
      const waiter = pending.get(value.id);
      if (!waiter) return;
      pending.delete(value.id);
      clearTimeout(waiter.timer);
      value.error ? waiter.reject(new Error(JSON.stringify(value.error))) : waiter.done(value.result);
    } else {
      for (const handler of handlers.get(value.method) || []) handler(value.params);
    }
  });
  function send(method, params = {}) {
    return new Promise((done, reject) => {
      const id = ++commandId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
      pending.set(id, { done, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  const on = (method, fn) => handlers.set(method, [...(handlers.get(method) || []), fn]);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const exceptions = [];
  const consoleErrors = [];
  const externalRequests = [];
  const dataRequests = [];
  const mockRequests = [];
  let formResponse = null;
  on("Runtime.exceptionThrown", (event) => exceptions.push(event.exceptionDetails.text + ": " + (event.exceptionDetails.exception?.description || "")));
  on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") consoleErrors.push(event.args.map((arg) => arg.value || arg.description || "").join(" "));
  });
  on("Fetch.requestPaused", (event) => {
    const url = new URL(event.request.url);
    if (url.origin === "https://formsubmit.co" && url.pathname === "/ajax/support@tmswizard.com" && formResponse) {
      // Intercept BEFORE the network; never forward a test enquiry to FormSubmit.
      const preflight = event.request.method === "OPTIONS";
      if (!preflight) mockRequests.push({ method: event.request.method, payload: JSON.parse(event.request.postData || "{}") });
      void send("Fetch.fulfillRequest", {
        requestId: event.requestId, responseCode: preflight ? 204 : formResponse.status,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: new URL(origin).origin },
          { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { name: "Access-Control-Allow-Headers", value: "Content-Type, Accept" },
        ],
        body: preflight ? "" : Buffer.from(formResponse.body).toString("base64"),
      });
    } else if (["localhost", "127.0.0.1"].includes(url.hostname)) {
      if (/\/(api|auth\/v1|rest\/v1)\//.test(url.pathname)) dataRequests.push(url.pathname);
      void send("Fetch.continueRequest", { requestId: event.requestId });
    } else {
      externalRequests.push(event.request.url);
      void send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*", requestStage: "Request" }] });
  const results = [];
  const utilityPages = ["/contact/thank-you", "/login", "/signup", "/auth/confirm"];
  const signupOrigin = process.env.SEO_SIGNUP_TEST_ORIGIN;
  if (signupOrigin) assert(["localhost", "127.0.0.1"].includes(new URL(signupOrigin).hostname), "Enabled-signup checks must target localhost");
  const pages = ["/", "/contact", "/features", "/features/transport-job-management", "/features/electronic-proof-of-delivery", "/features/transport-invoicing", "/guides/choosing-transport-management-software", "/legal", "/terms", "/privacy", "/cookies", "/cancellation-policy", "/dpa", "/accessibility", "/support-policy", "/acceptable-use", "/sub-processors", "/security", ...utilityPages];
  for (const width of [320, 375, 768, 820, 1024, 1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
    for (const path of pages) {
      await send("Page.navigate", { url: `${origin}${path}` });
      for (let i = 0; i < 50; i++) {
        if (await evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === "complete"`)) break;
        await delay(100);
      }
      await delay(500);
      const state = await evaluate(`(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
          path: location.pathname, title: document.title,
          h1: [...document.querySelectorAll("h1")].map(el => el.textContent),
          viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          mainTextLength: document.querySelector("main")?.innerText.length,
          mockClipped: (() => { const table = document.querySelector('[role="img"] table'); return table ? table.scrollWidth > table.parentElement.clientWidth : false; })(),
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          robots: document.querySelector('meta[name="robots"]')?.content,
          branded: !!document.querySelector('.tms-brand'),
          contrastFailures: (() => {
            const rgb = value => value.match(/[\\d.]+/g)?.map(Number);
            if (JSON.stringify(rgb('rgb(21, 35, 41)')) !== '[21,35,41]') throw new Error('Contrast parser failed');
            const luminance = values => values.slice(0,3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i],0);
            return [...document.querySelectorAll('.tms-brand *')].filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').flatMap(el => {
              const style = getComputedStyle(el), fg = rgb(style.color);
              let node = el, bg;
              while (node) { const value = rgb(getComputedStyle(node).backgroundColor); if (value && (value.length < 4 || value[3] === 1)) { bg = value; break; } node = node.parentElement; }
              if (!fg || !bg || (fg.length === 4 && fg[3] !== 1)) return [];
              const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
              const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
              return ratio + .01 < (large ? 3 : 4.5) ? [{ text: el.textContent.trim().slice(0,65), ratio: Number(ratio.toFixed(2)), color: style.color, background: bg }] : [];
            });
          })(),
          officialEmail: document.querySelector('a[href="mailto:support@tmswizard.com"]')?.textContent,
          officialPhone: document.querySelector('a[href="tel:08009991263"]')?.textContent,
          obsoleteContactLink: !!document.querySelector('a[href="/#request-access"]'),
          scriptCount: document.querySelectorAll('script[src]').length,
          scripts: [...document.querySelectorAll('script[src]')].map(el => el.src),
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        };
      })()`);
      assert.equal(state.path, path);
      assert.equal(state.h1.length, 1, `${path} at ${width}: H1`);
      if (utilityPages.includes(path)) {
        assert.equal(state.canonical, undefined, `${path}: utility has no canonical`);
        assert.equal(state.robots, "noindex, nofollow");
      } else {
        assert.equal(new URL(state.canonical).origin, "https://tmswizard.cloud");
        assert.equal(new URL(state.canonical).pathname, path);
      }
      assert(state.branded, `${path}: shared public brand`);
      assert.deepEqual(state.contrastFailures, [], `${path} at ${width}: text contrast`);
      assert.equal(state.officialEmail, "support@tmswizard.com");
      assert.equal(state.officialPhone, "0800 999 1263");
      assert(!state.obsoleteContactLink, `${path}: contact links updated`);
      assert(state.mainTextLength > 200, `${path}: server content available`);
      assert(state.scrollWidth <= width, `${path} at ${width}: overflow ${state.scrollWidth}`);
      assert(!state.mockClipped, `${path} at ${width}: illustrative table clipped`);
      if (path === "/") {
        assert(await evaluate(`getComputedStyle(document.querySelector('.price-number > span')).letterSpacing === 'normal'`), 'Billing period does not inherit large-price tracking');
      }
      if (width === 375 && ["/", "/contact", "/features/electronic-proof-of-delivery"].includes(path)) {
        const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(`.verification/seo-artifacts/${path === "/" ? "home" : path === "/contact" ? "contact" : "pod"}-375.png`, Buffer.from(screenshot.data, "base64"));
      }
      if (width === 1440 && ["/", "/contact", "/features", "/guides/choosing-transport-management-software", "/login", "/legal"].includes(path)) {
        const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync(`.verification/seo-artifacts/brand-${path === "/" ? "home" : path.split('/').at(-1)}-1440.png`, Buffer.from(screenshot.data, "base64"));
      }
      if (width === 1440 && path === "/") {
        for (const section of ["workflow", "features", "pricing", "request-access"]) {
          await evaluate(`document.getElementById(${JSON.stringify(section)}).scrollIntoView()`);
          await delay(100);
          const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          writeFileSync(`.verification/seo-artifacts/brand-home-${section}-1440.png`, Buffer.from(screenshot.data, "base64"));
        }
        await evaluate(`window.scrollTo(0,0)`);
      }
      if (width === 320 && path === "/") {
        await evaluate(`(() => { const button = document.querySelector('button[aria-controls="mobile-nav"]'); button.focus(); button.click(); })()`);
        await delay(100);
        assert(await evaluate(`document.querySelector('#mobile-nav') !== null`), "Mobile menu opens");
        assert(await evaluate(`document.querySelector('#mobile-nav a[href="/features"]') !== null`), "Mobile feature link");
        assert(await evaluate(`document.querySelector('#mobile-nav a[href="/contact"]') !== null`), "Mobile Contact link");
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await delay(100);
        assert(await evaluate(`document.querySelector('#mobile-nav') === null`), "Escape closes mobile menu");
        assert(await evaluate(`document.activeElement.getAttribute('aria-controls') === 'mobile-nav'`), "Escape returns focus to menu toggle");
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        const skipVisible = await evaluate(`(() => { const link = document.querySelector('a[href="#main"]'); link.focus(); return link.getBoundingClientRect().width > 1; })()`);
        assert(skipVisible, "Skip link visible on focus");
      }
      results.push({ width, ...state });
    }
  }

  // Verify the composed auth presentation without redeeming any token or
  // submitting a login request. All values here are inert local fixtures.
  await send("Page.navigate", { url: `${origin}/login?error=link_unavailable&next=/planning` });
  await delay(700);
  assert(await evaluate(`document.querySelector('[role="status"]').textContent.includes('already been used')`), "Consumed/expired link recovery retained");
  assert(await evaluate(`document.querySelector('[role="status"]').textContent.includes('do not need another invitation')`), "Existing invitation account uses ordinary login");
  await send("Page.navigate", { url: `${origin}/login?error=browser_context` });
  await delay(700);
  assert(await evaluate(`document.querySelector('[role="status"]').textContent.includes('browser where you started')`), "PKCE recovery retained");
  await send("Page.navigate", { url: `${origin}/auth/confirm?token_hash=local-inert-fixture&type=invite` });
  await delay(700);
  const confirmation = await evaluate(`(() => { const form = document.querySelector('form[action="/api/auth/callback"]'); return { branded: !!document.querySelector('.tms-brand'), method: form?.method, type: form?.elements.namedItem('type').value, oneTime: document.body.textContent.includes('Each link works once') }; })()`);
  assert.deepEqual(confirmation, { branded: true, method: "post", type: "invite", oneTime: true });

  // A second disposable server can enable the signup gate without opening it
  // on the primary validation server. Inspect fields only; never submit.
  const enabledSignupResults = [];
  if (signupOrigin) {
    for (const width of [320, 375, 768, 820, 1024, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await send("Page.navigate", { url: `${signupOrigin}/signup` });
      await delay(700);
      const state = await evaluate(`(() => ({ h1: [...document.querySelectorAll('h1')].map(el => el.textContent), fields: [...document.querySelectorAll('form [required]')].map(el => el.name), scrollWidth: document.documentElement.scrollWidth, robots: document.querySelector('meta[name="robots"]')?.content, canonical: document.querySelector('link[rel="canonical"]')?.href, branded: !!document.querySelector('.tms-brand') }))()`);
      assert.deepEqual(state.h1, ["Create your account"]);
      assert.deepEqual(state.fields, ["companyName", "contactName", "email"]);
      assert.equal(state.robots, "noindex, nofollow");
      assert.equal(state.canonical, undefined);
      assert(state.branded);
      assert(state.scrollWidth <= width, `Enabled signup overflow at ${width}`);
      enabledSignupResults.push({ width, ...state });
      if (width === 375) {
        const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        writeFileSync('.verification/seo-artifacts/brand-signup-enabled-375.png', Buffer.from(screenshot.data, 'base64'));
      }
    }
  }

  // Exercise form behaviour with every provider response fulfilled locally.
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: `${origin}/contact` });
  await delay(800);
  await evaluate(`document.querySelector('#enquiry-form').requestSubmit()`);
  await delay(150);
  assert.equal(mockRequests.length, 0, "Invalid form makes no request");
  assert.equal(await evaluate(`document.activeElement.name`), "name", "First invalid field receives focus");
  assert(await evaluate(`document.querySelector('#contact-name').getAttribute('aria-invalid') === 'true'`));
  assert(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('highlighted fields')`));
  const sample = { name: "SEO Local Tester", company: "Local Test Company", email: "test@example.invalid", phone: "", vehicles: "4", enquiry: "Product enquiry", message: "This is an intercepted local validation test, not a real enquiry." };
  await evaluate(`(() => { const values = ${JSON.stringify(sample)}; const form = document.querySelector('#enquiry-form'); for (const [name, value] of Object.entries(values)) form.elements.namedItem(name).value = value; })()`);

  formResponse = { status: 200, body: JSON.stringify({ success: "true", message: "Please check your email for activation." }) };
  await evaluate(`document.querySelector('#enquiry-form').requestSubmit()`);
  await delay(400);
  assert(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('not available yet')`), "Activation is not reported as success");
  assert(await evaluate(`document.querySelector('#enquiry-form') !== null`));

  formResponse = { status: 200, body: "invalid-json" };
  await evaluate(`document.querySelector('#enquiry-form').requestSubmit()`);
  await delay(400);
  assert(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('confirm your enquiry')`), "Malformed response produces useful error");
  assert.equal(await evaluate(`document.querySelector('#contact-message').value`), sample.message, "Failed enquiry retains details");

  formResponse = { status: 429, body: JSON.stringify({ success: false }) };
  await evaluate(`document.querySelector('#enquiry-form').requestSubmit()`);
  await delay(400);
  assert(await evaluate(`document.querySelector('[role="alert"]').textContent.includes('Too many enquiries')`));

  formResponse = { status: 200, body: JSON.stringify({ success: "true", message: "Success! Form submitted successfully." }) };
  const attemptsBeforeSuccess = mockRequests.length;
  await evaluate(`(() => { const form = document.querySelector('#enquiry-form'); form.requestSubmit(); form.requestSubmit(); })()`);
  await delay(400);
  assert.equal(mockRequests.length, attemptsBeforeSuccess + 1, "Duplicate submission is blocked");
  assert(await evaluate(`document.querySelector('[role="status"]').textContent.includes('Enquiry submitted')`));
  assert.equal(await evaluate(`document.activeElement.getAttribute('role')`), "status", "Success panel receives focus");
  assert.equal(mockRequests[0].method, "POST");
  assert.equal(mockRequests[0].payload.email, sample.email);
  assert.equal(mockRequests[0].payload._subject, "TMS Wizard website enquiry");
  assert.equal(mockRequests[0].payload._honey, "");

  await send("Page.navigate", { url: `${origin}/contact` });
  await delay(700);
  const attemptsBeforeHoney = mockRequests.length;
  await evaluate(`(() => { const form = document.querySelector('#enquiry-form'); form.elements.namedItem('_honey').value = 'bot value'; form.requestSubmit(); })()`);
  await delay(200);
  assert.equal(mockRequests.length, attemptsBeforeHoney, "Honeypot is dropped before sending");

  await send("Emulation.setScriptExecutionDisabled", { value: true });
  await send("Page.navigate", { url: `${origin}/contact` });
  await delay(500);
  const fallback = await evaluate(`(() => { const form = document.querySelector('#enquiry-form'); return { action: form.action, method: form.method, noValidate: form.noValidate, required: [...form.querySelectorAll('[required]')].length, next: form.elements.namedItem('_next').value }; })()`);
  assert.equal(fallback.action, "https://formsubmit.co/support@tmswizard.com");
  assert.equal(fallback.method, "post");
  assert.equal(fallback.noValidate, false, "Native validation without JavaScript");
  assert.equal(fallback.required, 5);
  assert.equal(fallback.next, "https://tmswizard.cloud/contact/thank-you");
  await send("Emulation.setScriptExecutionDisabled", { value: false });

  assert.deepEqual(exceptions, [], "No hydration/runtime exceptions on public pages");
  assert.deepEqual(consoleErrors, [], "No browser console errors on public pages");
  assert.deepEqual(dataRequests, [], "No application data requests on public pages");
  assert.deepEqual(externalRequests, [], "Public pages require no remote browser requests");
  writeFileSync(".verification/seo-artifacts/browser-results.json", JSON.stringify({ results, enabledSignupResults, exceptions, consoleErrors, dataRequests, externalRequests, interceptedFormRequests: mockRequests.length, nativeFallback: fallback, fonts: "Fonts served by the tested build; these are not field Core Web Vitals" }, null, 2));
  console.log(`PASS: ${results.length} page/viewport checks and ${enabledSignupResults.length} enabled-signup layouts; contact validation, activation/error/rate-limit/success, duplicate prevention, honeypot and native fallback. ${mockRequests.length} provider requests mocked locally; zero real enquiries.`);
} finally {
  socket?.close();
  browser.kill();
}
