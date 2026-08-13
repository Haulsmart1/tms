/* Layout regression check for /pod.
 *
 * WHY THIS EXISTS: on 2026-08-13 two separate overlap bugs shipped or nearly
 * shipped in this repo. Job-form inputs overflowed their boxes by 25 to 57px
 * with ordinary data, and the first POD mockup opened a several-hundred-pixel
 * gap mid-row. Both were invisible in review and obvious the instant something
 * rendered and measured them. Reading the CSS is not sufficient evidence.
 *
 * Run: node tests/pod-layout.spec.mjs   (dev server must be running, SIGNED IN)
 *
 * Playwright is NOT a dependency of this project, deliberately: it would pull a
 * browser download into every install for one script. Install it somewhere
 * outside the repo and run this file with that node_modules on the path. Do NOT
 * install it into this repo's node_modules.
 *
 * Exit codes:  0 = all widths pass   1 = a layout failure   2 = nothing measured
 */
import { chromium } from "playwright";

// NOT named URL: that would shadow the global URL constructor, which the
// redirect guard below needs in order to parse page.url().
const TARGET = process.env.POD_URL || "http://localhost:3000/pod";
const WIDTHS = [1920, 1440, 1280, 900, 375];

/* Inject pathologically long free text before measuring. Seed data is usually
   too tidy to catch a truncation failure, and the entire point of the
   fixed-width columns is that overlong text truncates instead of pushing into
   the next column. Set POD_NO_STRESS=1 to measure the real data instead. */
const LONG_NAME = "Cambridge Audio International Logistics Group Limited";
const LONG_VEHICLE = "Mercedes-Benz Actros 2545 BigSpace Nightrunner";

/* The three assertions, exported so they can be validated against fixtures
   with known-good and known-bad geometry. A detector nobody has ever seen
   detect anything is not evidence. */
export async function measure(page) {
  // 1. Nothing overflows its own container horizontally.
  const overflows = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((el) => {
        const parent = el.parentElement;
        if (!parent) return false;
        const p = parent.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        if (e.width === 0) return false;
        // A scroll container is allowed to hold something wider than itself.
        if (getComputedStyle(parent).overflowX !== "visible") return false;
        return e.right > p.right + 1 || e.left < p.left - 1;
      })
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 90)),
  );

  // 2. No two cells in the same row overlap.
  const collisions = await page.evaluate(() => {
    const bad = [];
    for (const row of document.querySelectorAll("tbody tr")) {
      const cells = [...row.children].map((c) => c.getBoundingClientRect());
      for (let i = 0; i < cells.length - 1; i++) {
        if (cells[i].right > cells[i + 1].left + 1) bad.push(`row cell ${i} overlaps ${i + 1}`);
      }
    }
    return bad;
  });

  // 3. The page itself never scrolls sideways.
  const bodyScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

  return { overflows, collisions, bodyScrolls };
}

/* Guard, and the most important part of this file. An unauthenticated /pod
   redirects to /login, and the TenantGate panel it renders instead satisfies
   every assertion above while measuring nothing at all. Without this check a
   signed-out run prints five PASS lines and means nothing. */
export async function assertOnRealPage(page) {
  const landed = new URL(page.url()).pathname.replace(/\/$/, "");
  if (landed !== "/pod") {
    return `redirected to ${landed} — not signed in`;
  }
  const hasQueue = await page.evaluate(
    () => Boolean(document.querySelector('[role="tablist"]') && document.querySelector("table")),
  );
  if (!hasQueue) return "/pod rendered without the queue table";
  return null;
}

// Importing this file for its exports must not launch a browser.
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`
  || process.argv[1]?.endsWith("pod-layout.spec.mjs");

if (isMain) {
  const stress = process.env.POD_NO_STRESS !== "1";
  const browser = await chromium.launch();
  let failures = 0;

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(TARGET, { waitUntil: "networkidle" });

    const problem = await assertOnRealPage(page);
    if (problem) {
      console.log(`ABORT  ${problem}. Nothing was measured.`);
      await browser.close();
      process.exit(2);
    }

    const rowCount = await page.evaluate(() => document.querySelectorAll("tbody tr").length);

    if (stress) {
      await page.evaluate(
        ([name, vehicle]) => {
          for (const row of document.querySelectorAll("tbody tr")) {
            const route = row.querySelector("td:nth-child(2) span span");
            if (route) route.textContent = name;
            const veh = row.querySelector("td:nth-child(4) span span");
            if (veh) veh.textContent = vehicle;
          }
        },
        [LONG_NAME, LONG_VEHICLE],
      );
    }

    const { overflows, collisions, bodyScrolls } = await measure(page);
    const ok = overflows.length === 0 && collisions.length === 0 && !bodyScrolls;

    console.log(
      `${ok ? "PASS" : "FAIL"}  ${width}px  (${rowCount} rows${stress ? ", stressed" : ""})`,
    );
    if (rowCount === 0) {
      // Not a failure, but an empty queue exercises none of the column
      // geometry, so a PASS on zero rows is not evidence the row layout holds.
      console.log("  NOTE: queue was empty, so no row geometry was measured at this width.");
    }
    if (!ok) {
      failures++;
      if (overflows.length) console.log("  overflow:", overflows.slice(0, 5));
      if (collisions.length) console.log("  collision:", collisions.slice(0, 5));
      if (bodyScrolls) console.log("  page scrolls horizontally");
    }
    await page.close();
  }

  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}
