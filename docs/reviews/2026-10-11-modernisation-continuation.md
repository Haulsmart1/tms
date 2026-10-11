# Modernisation continuation after login interruption

Danielle's authentication investigation took priority; see [the investigation](2026-10-11-danielle-login.md) for the diagnosis, safe recovery and evidence limits. No production mutation, real Auth email, account alteration, hosted Auth setting change or deployment was performed.

Resumed the existing operational modernisation by wiring selected-job context to an explicit inline Assistant control in the selected job detail. The control reads only the existing authorised `/api/assistant` endpoint, lazily after activation. It displays the server-projected job status and local advisory proposals, with no connected model or execution path. It aborts outstanding requests on selection/tenant changes and checks the returned entity/tenant/area before displaying facts. The existing job heading and operational actions retain priority. This reusable control supports customers/invoices, but only Jobs is wired in this increment.

Regression coverage adds an actual HTTP handler check that attributes selected-job facts to the requested record and authorised tenant while excluding contact information. Existing tests cover foreign/missing records, driver denial and projected secret exclusion. Signed-in browser/device interaction remains unverified; tests do not claim a browser accessibility certification.

React review covered hook order/dependencies, cancellation, narrow payloads, explicit activation, button disclosure semantics, status/error announcements and stable per-instance panel IDs. Typecheck passed. The offline Webpack build completed with TypeScript and 57 static pages; it uses the existing substitute-font/inert-Supabase verification script and is not a deployable release artifact.

First full suite: 253 files passed, one failed; 2,905 tests passed and the existing Square SDK dynamic-import environment guard timed out at 15 seconds while the build also ran. A focused rerun of Square, callback, login error and Assistant handler tests passed all 21 tests without test/timeout changes. Final full rerun is recorded below when complete.

Final verification: all 254 files and 2,906 tests passed in the full two-worker rerun (47.84 seconds). `git diff --check` passed. No assertions or test timeouts were weakened.

The wider handoff's unfinished installation/vault/webhook/receiver infrastructure, action-permission migration, other selected-record UIs and authenticated mobile/PWA checks remain outstanding. No historical worktree or dependency source was modified, and prior uncommitted modernisation files were preserved.
