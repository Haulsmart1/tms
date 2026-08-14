/* Layout regression check for /tracking.
 *
 * WHY THIS EXISTS: the same reason tests/pod-layout.spec.mjs exists. Two
 * separate overlap bugs shipped or nearly shipped in this repo on 2026-08-13.
 * Job-form inputs overflowed their boxes by 25 to 57px with ordinary data, and
 * the first POD mockup opened a several-hundred-pixel gap mid-row. Both were
 * invisible in review and obvious the instant something rendered and measured
 * them. Reading the CSS is not sufficient evidence.
 *
 * /tracking puts a four-card detail column beside a fixed 300px rail, which is
 * exactly that class of risk.
 *
 * SETUP, once (shared with pod-layout.spec.mjs):
 *   npm install playwright --prefix tests
 *   npx playwright install chromium
 *
 * Playwright is deliberately NOT in the root package.json: its browser download
 * would run on every Vercel build for one local script. Installing it under
 * tests/ keeps it resolvable from this file (ESM walks up from the module's own
 * directory) while staying gitignored, so deploys never see it.
 *
 * RUN, from the repo root, with the dev server up:
 *   LINK=$(node scripts/dev-login.mjs <email> /tracking | grep -o 'http://[^ ]*')
 *   TRACKING_AUTH_URL="$LINK" node tests/tracking-layout.spec.mjs
 *
 * Without TRACKING_AUTH_URL it aborts, because signed out /tracking redirects
 * to /login.
 *
 * Exit codes:  0 = passed   1 = a layout failure   2 = nothing measured
 */
import { chromium } from "playwright";

// NOT named URL: that would shadow the global URL constructor, which the
// redirect guard below needs in order to parse page.url().
const TARGET = process.env.TRACKING_URL || "http://localhost:3000/tracking";

/* One-shot sign-in URL, normally the callback link minted by
   scripts/dev-login.mjs. Visited ONCE before measuring.

   It has to be once: that token is single-use, exactly like a real magic link.
   So this runs in a single browser context and resizes the viewport between
   widths, rather than opening a fresh page per width, because a fresh page
   means a fresh context, an empty cookie jar, and a token already spent. */
const AUTH_URL = process.env.TRACKING_AUTH_URL || "";

/* The grid collapses at Tailwind's `lg`, 1024px, which is the breakpoint the
   approved spec names. 1440 is comfortably above it, where the grid is 300px +
   rest. 900 is comfortably below it, where the same grid stacks into one
   column. Both are kept clear of the boundary so a scrollbar's width cannot
   decide which side of it the viewport lands on. */
const WIDE = 1440;
const NARROW = 900;

/* Every check lands here with its own state, and SKIP is a state of its own on
   purpose. A check that found nothing to look at proved nothing, so folding it
   into the pass count would let an empty rail masquerade as evidence that the
   two columns sit side by side. */
const results = [];
const record = (name, state, detail) => results.push({ name, state, detail });
const check = (name, ok, detail) => record(name, ok ? "PASS" : "FAIL", ok ? "" : detail);

/* The measurements, exported so they can be pointed at fixtures with
   known-good and known-bad geometry. A detector nobody has ever seen detect
   anything is not evidence. */

// How far the document itself scrolls sideways. This is the failure mode both
// of the 2026-08-13 bugs shared.
export async function documentOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/* Elements spilling out of their own parent's box.
   Scoped to the `.ds` wrapper that holds <main>, NOT to every `.ds` on the
   page: AppShell's <aside> also carries the class, and its known mobile
   squeeze (docs/issues/2026-08-13-appshell-mobile-sidebar.md) is not a
   /tracking defect. Anything it reported here would be noise that trains the
   reader to ignore this check. */
export async function findSpills(page) {
  return page.evaluate(() => {
    const root = document.querySelector("main")?.closest(".ds");
    if (!root) return null;
    const bad = [];
    for (const el of root.querySelectorAll("*")) {
      const parent = el.parentElement;
      if (!parent) continue;
      const e = el.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      if (e.width === 0 || p.width === 0) continue;
      // A scroll container is allowed to hold something wider than itself.
      if (getComputedStyle(parent).overflowX !== "visible") continue;
      const spill = Math.round(Math.max(e.right - p.right, p.left - e.left));
      if (spill > 1) {
        const label = `${el.tagName.toLowerCase()}.${el.getAttribute("class") || "?"}`;
        bad.push(`${label.slice(0, 80)} spills ${spill}px`);
      }
    }
    return bad.slice(0, 10);
  });
}

/* Geometry of the two columns.
 *
 * The rail is anchored on the grid's own template class rather than on
 * `[aria-current]` or `.ds ul li button`. Both of those match the AppShell
 * sidebar first: its active nav link carries aria-current="page" and its <ul>
 * comes earlier in the document, so a stacked /tracking would still have
 * measured the sidebar's right edge against the map and reported a pass.
 *
 * Returns null when the grid is absent, which is a broken anchor rather than
 * an empty rail, and the caller treats the two differently.
 */
export async function readColumns(page) {
  return page.evaluate(() => {
    const grid = [...document.querySelectorAll("main div")].find((el) =>
      (el.getAttribute("class") || "").includes("grid-cols-[300px"),
    );
    const railColumn = grid?.firstElementChild;
    if (!railColumn) return null;

    const map = document.querySelector('section[aria-label="Vehicle position map"]');
    const r = railColumn.getBoundingClientRect();
    return {
      rows: railColumn.querySelectorAll("li button").length,
      railRight: Math.round(r.right),
      mapFound: Boolean(map),
      mapLeft: map ? Math.round(map.getBoundingClientRect().left) : 0,
    };
  });
}

/* Guard, and the most important part of this file. An unauthenticated
   /tracking redirects to /login, and the TenantGate panel it renders instead
   satisfies every assertion below while measuring nothing at all. The loading
   card and the query-failed card do the same, so both abort rather than being
   measured. */
export async function assertOnRealPage(page) {
  const landed = new URL(page.url()).pathname.replace(/\/$/, "");
  if (landed !== "/tracking") return `redirected to ${landed}, not signed in`;
  return page.evaluate(() => {
    if (!document.querySelector("main h1")) return "/tracking rendered without its heading";
    const text = document.body.innerText;
    if (text.includes("Could not load tracking")) return "the jobs query failed";
    if (text.includes("Loading jobs")) return "the page never left its loading state";
    return null;
  });
}

/* Returns the process exit code instead of calling process.exit, so the caller
   can close the browser first. process.exit skips finally blocks, which is how
   an aborted run leaks a chromium process. */
async function run(page) {
  await page.goto(AUTH_URL, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    console.log("ABORT  sign-in link rejected (expired, already used, or bad token).");
    console.log("       Mint a fresh one: node scripts/dev-login.mjs <email> /tracking");
    return 2;
  }

  await page.setViewportSize({ width: WIDE, height: 1000 });
  await page.goto(TARGET, { waitUntil: "networkidle" });

  // The rail arrives from a client-side query, so networkidle can land while
  // the loading card is still up.
  await page
    .waitForFunction(() => !document.body.innerText.includes("Loading jobs"), { timeout: 15000 })
    .catch(() => {});

  const problem = await assertOnRealPage(page);
  if (problem) {
    console.log(`ABORT  ${problem}. Nothing was measured.`);
    return 2;
  }

  // 1. The page itself never scrolls sideways.
  const wideOverflow = await documentOverflow(page);
  check("no horizontal overflow at 1440px", wideOverflow <= 1, `document overflows by ${wideOverflow}px`);

  // 2. Nothing spills out of its own parent's box.
  const spills = await findSpills(page);
  if (spills === null) {
    console.log("ABORT  no `.ds` wrapper around <main>. Nothing was measured.");
    return 2;
  }
  check("no child spills its parent", spills.length === 0, spills.join("; "));

  // 3. With rows in the rail, the detail column belongs beside it, not under it.
  const columns = await readColumns(page);
  if (!columns) {
    // Not an empty rail: the grid this check navigates by is gone, so the
    // check cannot be trusted to detect anything and must not report a pass.
    record("detail column sits beside the rail at 1440px", "FAIL", "the 300px grid is gone, so this check has nothing to measure");
  } else if (columns.rows === 0) {
    record(
      "detail column sits beside the rail at 1440px",
      "SKIP",
      "the rail was empty, so no job satisfied the on-the-road predicate",
    );
  } else if (!columns.mapFound) {
    record(
      "detail column sits beside the rail at 1440px",
      "FAIL",
      `the rail has ${columns.rows} rows but no map rendered beside them`,
    );
  } else {
    check(
      "detail column sits beside the rail at 1440px",
      columns.mapLeft >= columns.railRight - 1,
      `rail ends at ${columns.railRight}, map starts at ${columns.mapLeft}`,
    );
  }

  // 4. The stacking breakpoint, where the grid collapses to one column and a
  //    min-width that survived at 1440px stops fitting.
  await page.setViewportSize({ width: NARROW, height: 1000 });
  await page.waitForTimeout(300);
  const narrowOverflow = await documentOverflow(page);
  check(
    "no horizontal overflow at 900px",
    narrowOverflow <= 1,
    `document overflows by ${narrowOverflow}px`,
  );

  const failures = results.filter((r) => r.state === "FAIL");
  const skipped = results.filter((r) => r.state === "SKIP");
  const measured = results.length - skipped.length;

  for (const r of results) {
    console.log(`${r.state}  ${r.name}${r.detail ? `\n      ${r.detail}` : ""}`);
  }

  if (measured === 0) {
    console.log("ABORT  every check skipped. Nothing was measured.");
    return 2;
  }
  if (failures.length > 0) {
    console.log(`FAILED  ${failures.length} of ${measured} measured checks, ${skipped.length} skipped`);
    return 1;
  }
  console.log(`PASSED  ${measured} checks, ${skipped.length} skipped`);
  return 0;
}

// Importing this file for its exports must not launch a browser.
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`
  || process.argv[1]?.endsWith("tracking-layout.spec.mjs");

if (isMain) {
  // Checked before launching, so a missing link costs nothing.
  if (!AUTH_URL) {
    console.log("ABORT  TRACKING_AUTH_URL is required. See the header of this file.");
    process.exit(2);
  }

  const browser = await chromium.launch();
  // ONE context for the whole run, so the session cookie survives both widths.
  const context = await browser.newContext({ viewport: { width: WIDE, height: 1000 } });
  let code = 2;
  try {
    code = await run(await context.newPage());
  } catch (err) {
    // An exception means the measurements never completed, which is exit 2
    // territory, not a layout failure.
    console.log(`ABORT  the run threw: ${err.message}`);
  } finally {
    await browser.close();
  }
  process.exit(code);
}
