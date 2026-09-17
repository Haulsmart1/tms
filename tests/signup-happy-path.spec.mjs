/* Browser happy path for self-serve signup, against the LOCAL Supabase stack.
 *
 * WHY THIS EXISTS: the signup flow crosses four systems (the /signup page,
 * POST /api/signup, GoTrue's invite email, and /auth/confirm's POST form) and
 * ends on a dashboard whose first-run panel depends on RLS-scoped counts. Unit
 * tests cover each piece; this proves they meet. It never touches a hosted
 * project: the dev server must be started with .env.local.signup-test's
 * variables exported (they override .env.local), and the email is read from
 * Mailpit on port 54324, which only exists locally.
 *
 * SETUP, once (same as pod-layout.spec.mjs):
 *   npm install playwright --prefix tests
 *   npx playwright install chromium
 *   npx supabase start        (with docs/sql applied per prodfix_00_APPLY_ORDER.md, then signup_01)
 *
 * RUN, from the repo root:
 *   set -a; . ./.env.local.signup-test; set +a; npm run dev     (in one shell)
 *   node tests/signup-happy-path.spec.mjs                       (in another)
 *
 * Optional: SIGNUP_EMAIL=someone@local.test to reuse an address (it must be
 * fresh, or the route takes the existing-account branch by design), and
 * SIGNUP_SHOTS=<dir> to write screenshots.
 *
 * Exit codes:  0 = passed   1 = an assertion failed   2 = setup problem
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SIGNUP_BASE_URL || "http://localhost:3000";
const MAILPIT = process.env.SIGNUP_MAILPIT_URL || "http://127.0.0.1:54324";
const SHOTS = process.env.SIGNUP_SHOTS || "";
const EMAIL = process.env.SIGNUP_EMAIL || `happy-${Date.now()}@local.test`;
const COMPANY = "Happy Path Haulage Ltd";
const CONTACT = "Pat Happy";

/* Sentences the pages must and must not show. Kept as literals on purpose:
   importing lib/billing/pricingCopy.ts from an .mjs would need a build step,
   and a literal that drifts fails loudly rather than silently. */
const V1_SENTENCE = "first charge is taken today";
const V2_FRAGMENT = "Nothing is charged today";

const mailpitHost = new URL(MAILPIT).hostname;
if (!["127.0.0.1", "localhost"].includes(mailpitHost)) {
  console.error(`Refusing to run: SIGNUP_MAILPIT_URL must be local, got ${MAILPIT}`);
  process.exit(2);
}

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

/* Polls Mailpit for the newest message to `address` and returns the first
   /auth/confirm link in it. GoTrue sends asynchronously, so poll. */
async function waitForConfirmLink(address, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    if (res.ok) {
      const list = await res.json();
      const message = (list.messages || [])[0];
      if (message) {
        const detail = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
        const body = detail.HTML || detail.Text || "";
        const match = body.match(/href="([^"]*\/auth\/confirm[^"]*)"/) || body.match(/(https?:\/\/[^\s"<]*\/auth\/confirm[^\s"<]*)/);
        if (match) return { link: match[1].replace(/&amp;/g, "&"), subject: detail.Subject };
      }
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return null;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  console.log(`Signing up ${EMAIL} against ${BASE}`);

  /* 1. The form. */
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  check(page.url().startsWith(`${BASE}/signup`), "GET /signup renders without redirecting (public route)");
  check(await page.locator("h1", { hasText: "Create your account" }).count() === 1, "heading present");
  check((await page.locator("text=/From £[0-9.,]+ per 28 days/").count()) >= 1, "pricing headline from the rate card is shown");
  check((await page.locator('a[href="/terms"]').count()) === 1 && (await page.locator('a[href="/privacy"]').count()) === 1, "terms and privacy links present");
  check((await page.locator('a[href="/login"]').count()) >= 1, "log in link present");
  /* The sr-only WRAPPER is a 1px clipped box (the input inside keeps its own
     size and is clipped), and Playwright counts a 1px box as visible, so
     assert on the wrapper's geometry and the attributes instead. */
  const honeypot = page.locator('input[name="companyWebsite"]');
  const honeypotWrapper = page.locator('[aria-hidden="true"]:has(> input[name="companyWebsite"])');
  const wrapperBox = (await honeypotWrapper.count()) === 1 ? await honeypotWrapper.boundingBox() : null;
  check(
    (await honeypot.count()) === 1
      && wrapperBox !== null && wrapperBox.width <= 1 && wrapperBox.height <= 1
      && (await honeypot.getAttribute("tabindex")) === "-1",
    `honeypot is present, aria-hidden, 1px and out of the tab order (wrapper ${wrapperBox ? `${wrapperBox.width}x${wrapperBox.height}` : "missing"})`,
  );
  await shot(page, "01-signup-form");

  await page.fill("#companyName", COMPANY);
  await page.fill("#contactName", CONTACT);
  await page.fill("#email", EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="status"]:has-text("Check your inbox")', { timeout: 15000 });
  check(page.url().startsWith(`${BASE}/signup`), "success state renders in place, no redirect");
  await shot(page, "02-signup-sent");

  /* 2. The email. */
  const mail = await waitForConfirmLink(EMAIL);
  check(Boolean(mail), "invite email arrived in Mailpit with an /auth/confirm link");
  if (!mail) throw new Error("no email");
  const link = new URL(mail.link);
  check(link.searchParams.get("type") === "invite", `link type is invite (got ${link.searchParams.get("type")})`);
  check(Boolean(link.searchParams.get("token_hash")), "link carries a token_hash");
  check(link.origin === BASE, `link origin is the configured site URL (${link.origin})`);

  /* 3. Confirm: a GET does nothing, the human presses Continue. */
  await page.goto(mail.link, { waitUntil: "load" });
  check((await page.locator("h1", { hasText: "Confirm sign in" }).count()) === 1, "confirm page renders the Continue form");
  await shot(page, "03-confirm");
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 20000 }),
    page.click('button:has-text("Continue to TMS Wizzard")'),
  ]);
  check(new URL(page.url()).pathname === "/dashboard", "landed on /dashboard after Continue");

  /* 4. The dashboard and its first-run panel. */
  await page.waitForSelector('[data-step]', { timeout: 20000 });
  const steps = page.locator("[data-step]");
  check((await steps.count()) === 3, "getting-started panel shows three steps");
  check((await page.locator('[data-step][data-done="false"]').count()) === 3, "all three steps are undone for a new company");
  check((await page.locator('[data-step="card"] a[href="/settings/billing"]').count()) === 1, "card step links to /settings/billing");
  check((await page.locator('[data-step="vehicle"] a[href="/vehicles"]').count()) === 1, "vehicle step links to /vehicles");
  check((await page.locator('[data-step="driver"] a[href="/drivers"]').count()) === 1, "driver step links to /drivers");
  const dashboardText = (await page.locator("body").innerText()).toLowerCase();
  check(!dashboardText.includes(V1_SENTENCE), "dashboard never shows the v1 charge sentence");
  check(dashboardText.includes(V2_FRAGMENT.toLowerCase()), "dashboard card step uses the v2 wording");
  check((await page.locator("nav, aside").count()) >= 1, "console shell is present on the dashboard");
  await shot(page, "04-dashboard");

  /* 5. Billing: v2 body, card form, no v1 wording. */
  await page.goto(`${BASE}/settings/billing`, { waitUntil: "load" });
  await page.waitForSelector("text=Payment method", { timeout: 20000 });
  /* The skeleton also says "Payment method"; the card notice arrives with the
     billing preview, so wait for it (both v1 and v2 notices begin "Add a card"). */
  await page.waitForSelector("text=Add a card", { timeout: 20000 });
  const billingText = (await page.locator("body").innerText()).toLowerCase();
  check(!billingText.includes(V1_SENTENCE), "billing page never shows the v1 charge sentence");
  check(billingText.includes(V2_FRAGMENT.toLowerCase()), "billing page shows the v2 card setup sentence");
  check(!billingText.includes("per vehicle per week"), "billing page shows no v1 per-week pricing");
  await shot(page, "05-billing");

  /* 6. A signed-in admin opening /signup sees the page without console chrome. */
  await page.goto(`${BASE}/signup`, { waitUntil: "load" });
  check((await page.locator("h1", { hasText: "Create your account" }).count()) === 1, "signed-in visit to /signup renders the page");
  check((await page.locator("aside").count()) === 0, "signed-in visit to /signup shows no console shell");
  await shot(page, "06-signup-signed-in");

  /* 7. Replaying the used invite link is refused. */
  await context.clearCookies();
  await page.goto(mail.link, { waitUntil: "load" });
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/login" || u.pathname === "/dashboard", { timeout: 20000 }),
    page.click('button:has-text("Continue to TMS Wizzard")'),
  ]);
  const after = new URL(page.url());
  check(after.pathname === "/login" && Boolean(after.searchParams.get("error")), `replayed invite token is refused (landed on ${after.pathname}?${after.searchParams})`);
  await shot(page, "07-replay-refused");

  console.log(`\nSIGNUP_USER_EMAIL=${EMAIL}`);
} catch (err) {
  failures += 1;
  console.error("FAIL", err);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
