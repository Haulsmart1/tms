# Planning mobile overflow — focused repair review

Date: 19 October 2026. Review-only; no production acceptance claimed.

## Incident and demonstrated layout cause

Stuart supplied an iPhone screenshot of `/planning` (`IMG_0245.png`). It shows
job selection occupying most of the available width, vehicle/driver-hours
content compressed into narrow strips, and the floating TMS Assistant covering
job cards. The screenshot contains operational information and is not embedded
in this review.

The source layout explains that failure: the planning board kept its horizontal
flex arrangement on narrow screens while the unassigned pool retained a fixed
240 px width. Descendants were not consistently permitted to shrink or wrap.
The Assistant was fixed over the workspace at mobile sizes.

## Focused repair scope

- Stack the job pool and vehicle/driver-hours workspace below the desktop
  breakpoint; retain the horizontal board and 240 px pool at desktop sizes.
- Let the page, board columns, cards and vehicle headers shrink within their
  parent; wrap long references and labels rather than expanding the page.
- Constrain and wrap planning controls, keeping selection and driver-assignment
  controls usable without removing their existing event handlers.
- Put the Assistant after the workspace in normal flow on phones and tablets,
  with safe-area padding. Retain constrained floating guidance on desktop.
- Preserve the existing planning, assignment, routing, evidence and queue logic.

## Verification boundaries

The requested width matrix is 320, 375 and 390 px (phones), 768 px (tablet),
and 1024/1440 px (desktop). The source-component SSR fixtures and compiled
Tailwind/CSS contract checks are useful regression evidence, but they are
**not browser geometry measurements**. They do not establish that
`scrollWidth <= clientWidth`, demonstrate iOS Safari behaviour, or prove actual
touch/scroll interactions.

An installed local Chromium/Firefox executable or Playwright browser cache was
not found in the inspected execution environment. No browser dependencies were
downloaded and the previously failed Chromium download was not retried.

The supported cloud Chrome interface is available, but does not advertise
viewport resize/emulation, request mocking or `setContent`. A controlled local
HTTP fixture was started on port 8765; navigating the cloud browser to
`http://127.0.0.1:8765` returned `net::ERR_CONNECTION_REFUSED`. The fixture server
was then stopped. No undocumented port forwarding or alternate network route
was attempted.

Consequently, **no repaired mobile-browser screenshot was captured in this
run**. A READY preview and passing source/CSS tests must not be described as
hosted mobile acceptance. Before release, check the real authenticated planning
page at the width matrix above with representative long references, multiple
vehicles, driver-hours content, selection/assignment, scroll and Assistant
open/closed states. Confirm desktop layout and all existing queued evidence
remain intact.

## Authentication remains a separate gate

The coordinator's read-only preview log inspection found a single limiter
request at 21:08:36 UTC represented by two log lines returning HTTP 429 before
email dispatch. The underlying error code was not observed. This was not tied
to Danielle and does not establish the cause of her production sign-in loop.
The corresponding production error search over one hour was clean; that
absence is not proof of successful sign-in. The required function was present
in the read-only database catalogue check.

Real hosted sign-in, cookie retention, tenant loading and reload acceptance
remain outstanding. This layout repair neither claims to fix that incident nor
changes accounts, credentials, roles or auth configuration.

## Change restrictions

No production merge/deployment, live configuration/schema/data change,
customer communication, or clearing of offline POD/driver queues is authorised
by this review.

## Final verification and candidate inventory

The coordinator recorded the following actual results for this candidate:

- Full Vitest suite: **292 files, 3,332 tests passed**.
- The 17 new regression checks comprise 13 planning source-component SSR and
  compiled-CSS checks (including the 320/375/390/768/1024/1440 px width matrix)
  and four Assistant SSR/source-CSS checks.
- An independent focused run: **63 tests passed**. This overlaps the full suite
  and is not an additional 63 unique tests.
- The helper's final `tsc --noEmit` check passed.
- The coordinator's offline Next.js webpack build passed using synthetic
  Supabase configuration and substitute fonts. This is test-only build
  evidence, **not a deployment artifact**.

The candidate contains exactly ten changed files:

1. `app/components/ApplicationFrame.tsx`
2. `app/planning/page.tsx`
3. `app/planning/UnassignedPool.tsx`
4. `app/planning/VehicleLane.tsx`
5. `app/planning/PlanJobCard.tsx`
6. `components/assistant/ContextualAssistant.tsx`
7. `components/assistant/contextualAssistant.module.css` (new)
8. `lib/planning/mobileLayout.test.ts` (new)
9. `lib/assistant/mobileLayout.test.ts` (new)
10. `docs/reviews/2026-10-19-planning-mobile-repair.md` (new)

The six TSX files are modified existing components; no public dummy test page
was added. The candidate was built from the existing PR40 head on the new,
isolated branch `review/planning-mobile-acceptance-20261019`, targeting `main`.
The existing PR40 branch was not edited. The coordinator will record the new
PR and exact preview separately after creation and verification.

These checks do not remove the browser and hosted acceptance limitations
above: **no repaired mobile-browser screenshot was captured**.
