# Landing redesign: documented follow-ups

Open items from the five-lens pre-merge review of `feat/landing-redesign`.
All 2 critical and all 8 high findings were fixed before merge; these are the
remainder, deliberately deferred with the user's agreement.

Severity is the reviewer's. Read it as "how likely is this to bite", not "how
urgent". A few of the mediums matter more to a lawyer than to a build.

## Medium

### RLS script only drops pre-existing INSERT policies and only revokes write grants, so it cannot clean a stray SELECT policy on re-run

- **Lens:** security  
- **Where:** docs/sql/registration_requests_rls.sql:26-40 (do-block filtered to cmd = 'INSERT') and line 43 (revoke insert, update, delete)
- **Problem:** The script advertises itself as "Safe to re-run" and was written precisely because a leftover permissive INSERT policy was found live. The same class of leftover for SELECT would expose every lead's name, business email and phone number to anyone holding the public anon key, and the script would not remove it: the loop filters on cmd = 'INSERT', and the only drops for select/update are `drop policy if exists` against the script's own policy names. Line 43 likewise revokes insert/update/delete from anon but never select. Today's live check (anon select returns nothing) means this is not currently exploited, but the runbook does not guarantee that state after any future policy edit. The commented-out "OPTIONAL BELT AND BRACES" block at lines 95-97 also duplicates the already-active revoke at line 43, which is confusing for whoever runs this next.
- **Fix:** Drop the `and cmd = 'INSERT'` filter so the do-block removes every pre-existing policy on public.registration_requests before the three intended policies are created; add `revoke select on public.registration_requests from anon;` alongside line 43; and delete the now-redundant commented block at lines 95-97 so the file has one authoritative revoke.

### Read policy's security rests entirely on profiles.role_id not being self-writable, which this branch neither enforces nor documents

- **Lens:** security  
- **Where:** docs/sql/registration_requests_rls.sql:49-64 (select policy) and 67-88 (update policy)
- **Problem:** Both policies authorise via `exists (select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and r.name = 'super_admin')`. That is only as strong as the write policy on public.profiles: if any authenticated user can update their own row's role_id, they self-elevate and gain read access to every prospect's name, email and phone. No profiles policy ships in this branch or anywhere in docs/sql, so the guarantee is unverifiable from the repo. Secondly, the subquery is evaluated under the caller's own RLS on profiles and roles; if either table has a restrictive policy that hides the joined row, exists() returns false and the genuine super admin silently sees an empty table plus the generic 'Could not load requests' banner at app/super-admin/requests/page.tsx (error branch) with no way to tell misconfiguration from no-data.
- **Fix:** Add a `security definer` helper, e.g. `create function public.is_super_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from profiles p join roles r on r.id = p.role_id where p.id = auth.uid() and r.name = 'super_admin') $$;` and use `using (public.is_super_admin())` in all three clauses, so the check does not depend on profiles/roles RLS. Separately, add the profiles UPDATE policy (or a BEFORE UPDATE trigger) that blocks a non-super-admin from changing their own role_id, and commit it next to this file so the assumption is visible.

### role="alert" never re-announces a repeated identical error message

- **Lens:** a11y  
- **Where:** components/landing/RequestAccessForm.tsx:160-164 (setMessage at 46-51)
- **Problem:** The form-level live region renders only when `message` is truthy, and the message strings are fixed literals. Concrete failure: a user submits with two bad fields and hears 'Please check the highlighted fields.' They fix one field and submit again; validation still fails; setMessage is called with the byte-identical string. React diffs the text node, sees no change, and mutates nothing. role="alert" fires on content change, so nothing is announced. The screen-reader user gets total silence on the second failure and has no way to know the submit was even processed. The same applies to repeated 429s and repeated network failures. The role="alert"-inserted-with-content pattern is also the less reliable of the two live-region idioms; the robust one is a region present in the DOM from first paint and later filled.
- **Fix:** Render the alert container unconditionally and only vary its contents, so the region is registered before it ever changes. To defeat the identical-string case, key the announcement on an incrementing counter: keep a submitCount in state and store { text, id: submitCount }, rendering <p role="alert" key={id}> so a repeat failure remounts the text node and re-fires. The same fix applies to the message paragraph at app/login/page.tsx:87-91.

### No focus management on validation failure, and the announced message does not identify the failing fields

- **Lens:** a11y  
- **Where:** components/landing/RequestAccessForm.tsx:45-51
- **Problem:** When the API returns fieldErrors, the component sets per-field errors and a generic 'Please check the highlighted fields.' and stops. Focus stays on the submit button at the very bottom of a six-field form. 'Highlighted' is a purely visual instruction and conveys nothing to a non-sighted user. The per-field text is correctly wired via aria-describedby and aria-invalid, but that only helps once focus reaches the input -- the user has to Shift-Tab blindly back through up to six controls to discover which two are wrong. This satisfies the letter of 3.3.1 (errors are in text and programmatically associated) but not its intent, and it is the difference between a form that is usable with a screen reader and one that merely technically complies.
- **Fix:** After setErrors, move focus to the first invalid control. Keep the field order as a const array (const ORDER: FieldKey[] = ["companyName","contactName","email","phone","vehicles","notes"]), find the first key present in the returned fieldErrors, and call document.getElementById(key)?.focus(). The input's own aria-describedby then reads the specific error on arrival. Also replace the generic string with a count-bearing one such as '2 fields need attention.' so the alert carries information even before focus moves.

### Loading state is not perceivable to any user: no visible indicator, and aria-busy on a button is not announced

- **Lens:** a11y  
- **Where:** components/Button.tsx:62-78
- **Problem:** While `loading` is true the button gets cursor-wait, aria-disabled and aria-busy, and keeps its original children. Nothing else changes. The `disabled:opacity-60` in the base string does not apply because `disabled` is deliberately left undefined. So visually the only feedback that a network request is in flight is the mouse cursor -- which touch users and keyboard users never see. For assistive tech, aria-busy on a <button> is not reliably announced by NVDA, JAWS or VoiceOver (it is meaningful mainly on live regions and composite widgets), and aria-disabled="true" on a control that remains fully operable actively misinforms: AT announces 'dimmed'/'unavailable' while the button still responds to Enter. Neither a sighted nor a screen-reader user is told the submission is in progress, which is a 4.1.3 Status Messages gap on the primary conversion action of the page. Separately verified as fine: the double-submit guard itself genuinely works for keyboard, since Enter on the button and implicit submission from any text field both dispatch `submit` and hit `if (loading) return`.
- **Fix:** Keep the button focusable (that decision is correct), but make the state perceivable. Add a visible spinner alongside the retained label while loading, and render a polite live region in the form that announces progress, e.g. <p role="status" className="sr-only">{loading ? "Sending your request" : ""}</p> in RequestAccessForm and LoginPage. Also render an sr-only ', busy' suffix inside the button, or drop aria-disabled and rely on aria-busy plus the live region, so AT is not told the control is unavailable when it is not.

### Login page error is not associated with the field it describes, and the Field error prop is left unused

- **Lens:** a11y  
- **Where:** app/login/page.tsx:35-38, 71-91
- **Problem:** The empty-email guard sets setMessage('Please enter your email address.'), which renders in a role="status" paragraph at line 87-91, positioned after the form and completely disconnected from the input. The Field component accepts an `error` prop that wires errorId into aria-describedby and sets aria-invalid, and it is not passed here. So the email input is never marked invalid, its error is never in its accessible description, focus is never moved to it, and the message is announced (if at all) via a polite region rather than an assertive one. That paragraph is also doing double duty as both the error channel and the success channel ('Login link sent. Check your email.'), so it cannot be given the correct role for either. WCAG 3.3.1 Error Identification (Level A).
- **Fix:** Split the two channels. Hold a separate emailError in state, pass it as <Field ... error={emailError} /> so aria-invalid and aria-describedby are set on the input, and focus the input when the guard trips. Leave the role="status" paragraph for the success/informational message only, and add a role="alert" region for Supabase-returned errors from line 49.

### The RLS hardening script's policy cleanup misses FOR ALL policies, so the anon-insert hole it exists to close can survive

- **Lens:** regression  
- **Where:** docs/sql/registration_requests_rls.sql:26-38
- **Problem:** The do-block was added specifically because a leftover permissive insert policy was found live letting anon POST straight to PostgREST past the honeypot and rate limit. But it filters on `where ... and cmd = 'INSERT'`. In pg_policies, a policy created with `for all` reports cmd = 'ALL', not 'INSERT', and an ALL policy grants insert. So the one class of leftover policy that is most likely to exist (Supabase's own "Enable all access" template) is exactly the one this loop will not drop, and the script is advertised as "Safe to re-run" hardening. The live verification currently passes only because the `revoke insert, update, delete ... from anon` on line 42 is doing the work; if anyone re-grants those privileges the RLS layer alone would not hold.
- **Fix:** Widen the filter at docs/sql/registration_requests_rls.sql:32 to `and cmd in ('INSERT', 'ALL')`, and after running it re-verify with `select policyname, cmd, roles from pg_policies where tablename = 'registration_requests'` that no ALL-command policy remains.

### Plan's file-structure and scope sections are missing five shipped files and self-contradict

- **Lens:** consistency  
- **Where:** docs/superpowers/plans/2026-07-22-landing-redesign.md:5, 9, 23-44
- **Problem:** The "Created" list omits components/Textarea.tsx, lib/supabase/admin.ts, app/super-admin/requests/page.tsx, docs/sql/registration_requests_rls.sql and .env.example. The "Modified" list omits app/super-admin/layout.tsx and .gitignore/next-env.d.ts. Line 44 asserts "Unchanged: every other route", which app/super-admin/layout.tsx and the new /super-admin/requests route both falsify. The Goal at line 5 and Architecture at line 9 still describe lead capture as "validates with Zod and emails via Resend" and list the primitives as Button/Field/Badge/Container with no Textarea. Separately, every one of the plan's ~60 step checkboxes is still `- [ ]` on work that is fully built and about to merge, so the plan gives no signal about what was actually done.
- **Fix:** Add the five missing files to the Created list and the two to Modified; change line 44 to "Unchanged: every other route except app/super-admin/layout.tsx, which gains one nav link"; update the Goal and Architecture sentences to name Supabase persistence, Textarea, and the super-admin requests page; and tick the checkboxes for completed steps (or add a one-line status banner at the top: "Implemented through Task 12 plus three post-plan commits, see docs/landing-redesign-guide.md").

### No committed DDL for registration_requests, and the route depends on a `status` column default that is defined nowhere

- **Lens:** product  
- **Where:** app/api/request-access/route.ts:79-100, app/super-admin/requests/page.tsx:126, docs/sql/registration_requests_rls.sql
- **Problem:** app/api/request-access/route.ts:79 deliberately omits `status` "so the column default applies", but nothing in the repository creates the table or defines that default. docs/sql/registration_requests_rls.sql only alters an already-existing table. The column set (company_name, contact_name, email, phone, vehicle_count, notes, status, created_at) exists only as an assumption split between the insert at route.ts:93-100 and the select at app/super-admin/requests/page.tsx:51. If the live column has no default, every stored lead has status NULL, and app/super-admin/requests/page.tsx:126 renders a grey Badge reading "unknown" on every single row from day one. There is also no UI to change status, despite the RLS script granting super admins UPDATE for exactly that purpose (docs/sql/registration_requests_rls.sql:63-88), so even a correct default is a value nobody can ever move.
- **Fix:** Commit the DDL as docs/sql/registration_requests_table.sql with `create table if not exists`, `status text not null default 'new'`, and `created_at timestamptz not null default now()`, and reference it as step one in the guide's go-live checklist. Separately, either add a small status control to the requests page or change the fallback at app/super-admin/requests/page.tsx:126 from "unknown" to "new" so an unconfigured default does not read as an error.

### Privacy and Terms footer links are dead `href="#"` on a page that collects personal data

- **Lens:** product  
- **Where:** components/landing/Footer.tsx:12-17, components/landing/RequestAccessForm.tsx:166
- **Problem:** components/landing/Footer.tsx:12-17 renders Privacy and Terms as `<a href="#">`, which jumps to the top of the page and nothing else. The same page collects contact name, email, phone and company name from UK and EU visitors and stores them in a database (app/api/request-access/route.ts:93-100). There is no privacy notice at the point of collection, no consent line near the submit button, and no company registration details or contact address anywhere on the site. For a UK company selling B2B software to operators who will scrutinise a supplier, a customer clicking Privacy and getting nothing is both a credibility problem and a UK GDPR Article 13 gap.
- **Fix:** Either write minimal /privacy and /terms pages and point the links at them, or remove the two links until they exist rather than shipping stubs. Add a one-line notice under the submit button in components/landing/RequestAccessForm.tsx around line 166: "We will use these details only to contact you about TMS Wizzard." Add the registered company name and address to the footer.

## Low

### Real named-individual internal recipient address committed in .env.example

- **Lens:** security  
- **Where:** .env.example:24 (LEAD_INBOX=stuart@adrcarriers.net)
- **Problem:** Not a secret, but the template ships a live business address for a named person plus the internal lead-routing destination. Every other value in the file is an empty placeholder, so this is the one line that publishes real operational data if the repo is ever shared, forked or open-sourced. It also makes the address a ready-made target for the spam vector in finding 1.
- **Fix:** Set the line to `LEAD_INBOX=leads@example.com` in .env.example and put the real address only in the deployment environment variables.

### Auth callback redirect base is derived from the request Host header rather than a pinned site URL

- **Lens:** security  
- **Where:** app/api/auth/callback/route.ts:26 (const url = new URL(request.url)) and lines 35, 58, 62 (redirects built against url.origin)
- **Problem:** safeNextPath is correct in isolation, but the origin it validates against is the same attacker-influenceable value used to build the final redirect. `request.url` in Next resolves from the Host / x-forwarded-host header, so on any deployment path where that header is not validated, url.origin becomes the attacker host, safeNextPath's same-origin comparison passes trivially, and NextResponse.redirect sends the freshly authenticated user (with the session cookie just set on the response) to the attacker host. Vercel validates Host, so this is not exploitable on the current deploy target, and it is a pre-existing pattern rather than something this branch introduced.
- **Fix:** When NEXT_PUBLIC_SITE_URL is set, use it as the canonical origin for both the safeNextPath comparison and the NextResponse.redirect base, falling back to url.origin only in local development.

### New design-system pages have no <main> landmark

- **Lens:** a11y  
- **Where:** app/login/page.tsx:62, app/super-admin/requests/page.tsx:57
- **Problem:** Both new pages render their content directly into a <div>. Unlike app/page.tsx, which correctly wraps its sections in <main>, these leave all content outside any landmark, so screen-reader landmark navigation and browser skip-to-content affordances have nothing to target. On the requests page this matters more because app/super-admin/layout.tsx:40 supplies a <header> with seven repeated nav links that a user must traverse on every super-admin page view with no way to bypass them. WCAG 2.4.1 Bypass Blocks is arguably satisfied by headings alone, but landmarks are the standard technique and the landing page already uses them correctly.
- **Fix:** Change the outer <div> to <main> on both pages (the className list transfers unchanged). On app/super-admin/layout.tsx:82, change the <div>{children}</div> wrapper to a fragment so the page-level <main> is not nested inside a generic div, and give the layout's <header> an aria-label such as 'Super admin'.

### role="alert" on server-rendered static content never fires

- **Lens:** a11y  
- **Where:** app/super-admin/requests/page.tsx:65-72
- **Problem:** This is a server component, so the error block is present in the initial HTML. Live regions only announce content that changes after the region has been registered; a role="alert" that already exists at first paint is announced by essentially no AT/browser combination. The markup implies an announcement that will never happen. Not a contrast or comprehension failure since the text is visible and readable, but it is misleading to maintainers and means a super-admin using a screen reader gets no signal that the table failed to load beyond the absence of rows.
- **Fix:** Drop role="alert" and make the failure structurally discoverable instead: give the block a heading (e.g. an h2 'Could not load requests') so it appears in heading navigation, and keep the visual danger styling. Reserve role="alert" for client-side state changes.

### Footer and desktop nav link targets are below the 24px minimum (WCAG 2.2 SC 2.5.8, not 2.1)

- **Lens:** a11y  
- **Where:** components/landing/Footer.tsx:11-20, components/landing/LandingNav.tsx:26-34
- **Problem:** Compiled sizes: footer links are text-xs = 12px/16px line-height with gap-4 (16px) horizontal separation, giving roughly a 16 by 16 target with 16px clearance. Desktop nav anchors are text-sm = 13px/18px with gap-6 (24px). Neither reaches the 24 by 24 CSS pixel minimum of SC 2.5.8, and the footer's 16px gap also fails that SC's spacing exception. These are standalone navigation links, not links inline within a sentence, so the inline exception does not apply. Being explicit about scope: WCAG 2.1 AA contains no target-size success criterion, so this is not a failure of the standard the design system claims. Reported because 2.5.8 is the current AA bar under 2.2 and because it is inconsistent with the rest of the work, which gets this right -- the mobile menu correctly uses min-h-11 (44px, confirmed in the compiled CSS) and the mobile toggle is h-11 w-11.
- **Fix:** Add 'inline-flex min-h-6 items-center' to the footer anchors and widen the footer nav to gap-6, and add 'inline-flex min-h-6 items-center' to the desktop nav anchors in LandingNav. Both are purely additive and will not change the visual layout of the 56px header or the 24px footer row.

### aria-controls points at a non-existent element while the mobile menu is closed, and Escape does not close it

- **Lens:** a11y  
- **Where:** components/landing/LandingNav.tsx:50, 59-81
- **Problem:** The toggle always carries aria-controls="mobile-nav", but the panel with that id is only rendered when `open` is true (line 59 short-circuits to null), so while closed the IDREF dangles. Browsers and AT tolerate this and it is not a WCAG failure, but automated audits flag it and the more useful pattern keeps the relationship valid. Separately, the disclosure has no Escape handler; a keyboard user who opens the menu and changes their mind must Shift-Tab back to the toggle to close it. Correctly, this is not a modal so no focus trap is required, and the DOM order (panel as a sibling immediately after the toggle) does give a sensible tab sequence, and both close paths preserve focus properly. This is polish rather than a defect.
- **Fix:** Always render the panel and toggle visibility with the hidden attribute driven by state: <div id="mobile-nav" hidden={!open} ...>, so the id is permanently in the DOM. Add an onKeyDown on the header that calls setOpen(false) when event.key === 'Escape' and returns focus to the toggle button via a ref.

### Placeholder href="#" links for Privacy and Terms ship on the production landing page

- **Lens:** regression  
- **Where:** components/landing/Footer.tsx:12 and components/landing/Footer.tsx:15
- **Problem:** Both the Privacy and Terms footer links are `href="#"`. They scroll to the top of the page and do nothing else. On a commercial marketing page that also collects personal data (name, email, phone) through the request-access form, a non-functional Privacy link is leftover scaffolding with a compliance edge to it. Combined with finding 1 these are also the two links that render in raw UA link blue.
- **Fix:** Either point them at real routes, or drop the two anchors from components/landing/Footer.tsx until the pages exist. Do not ship href="#".

### Rate limiter allows 6 requests per window, one more than the declared RATE_LIMIT_MAX of 5

- **Lens:** regression  
- **Where:** app/api/request-access/route.ts:41
- **Problem:** isRateLimited pushes the current timestamp into the array before comparing, then returns `mine.length > RATE_LIMIT_MAX`. With RATE_LIMIT_MAX = 5 the 6th request in a 60s window has length 6 and is the first one rejected, so five requests are allowed plus one, not five. Off by one against the constant's stated meaning. Harmless in effect, but the constant no longer means what it says, which is the kind of thing that gets mis-tuned later.
- **Fix:** Change the comparison at app/api/request-access/route.ts:41 to `return mine.length > RATE_LIMIT_MAX;` -> `return mine.length >= RATE_LIMIT_MAX + 1;` if you want to keep the current behaviour explicit, or move the push after the check and use `>=` if you want a true max of 5.

### AppHeader is not exempted on /login, so a signed-in visitor sees the legacy dark app nav above the design-system card

- **Lens:** regression  
- **Where:** app/components/AppHeader.tsx:71
- **Problem:** The guard is `if (pathname === "/" || pathname.startsWith("/super-admin")) return null;`. Sign-in moved from / to /login, but /login was not added to the exemption. AppHeader only renders for signed-in users, so the case is a signed-in user navigating to /login (bookmark, back button, or an already-consumed magic link that redirected to /login?error=auth while a session still existed). They get the inline-styled #0f172a nav bar with 15 app links stacked directly above the centred IBM Plex sign-in card. Two visual systems on one screen.
- **Fix:** Add /login to the exemption at app/components/AppHeader.tsx:71: `if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) return null;`.

### .gitignore is now a mixed-encoding file that git classifies as binary

- **Lens:** regression  
- **Where:** .gitignore (bytes 0x77-0xac)
- **Problem:** The diff reports `.gitignore | Bin 254 -> 609 bytes`, meaning git no longer treats it as text. A hexdump shows a UTF-16LE block spliced into the middle of an otherwise UTF-8 CRLF file: bytes 0x77 onward contain `n\0o\0d\0e\0_\0m\0o\0d\0u\0l\0e\0s\0/\0` and `.\0n\0e\0x\0t\0/\0`, followed by a second UTF-8 copy of the same two entries. I verified the file still works functionally (git check-ignore resolves .env.local to line 17, next-env.d.ts to line 27, .env.example correctly NOT ignored via the negation), so nothing is broken today. The cost is that this file can never again be reviewed as a text diff, and the garbage lines are silently inert patterns.
- **Fix:** Rewrite .gitignore as clean UTF-8 with LF endings, dropping the UTF-16 block and the duplicated node_modules / .next entries, then confirm with `git diff --stat` that it shows a line count rather than `Bin`.

### Dead commented-out block in the RLS script duplicates a statement that already runs above it

- **Lens:** regression  
- **Where:** docs/sql/registration_requests_rls.sql:88-95
- **Problem:** The "OPTIONAL BELT AND BRACES" section says "If you would rather anon could not even attempt a write, revoke the grants as well" and offers a commented-out `-- revoke insert, update, delete on public.registration_requests from anon;`. That exact statement is already live and uncommented at line 42. A future reader following the script top-to-bottom is told an option is available that has in fact already been taken, which invites confusion about whether the revoke actually applied.
- **Fix:** Delete the commented block at docs/sql/registration_requests_rls.sql:88-95, or reword it to note the revoke is already applied on line 42.

### min-h-screen on a page nested inside the super-admin shell guarantees a permanent scrollbar

- **Lens:** regression  
- **Where:** app/super-admin/requests/page.tsx:54
- **Problem:** The new page's root is `className="ds min-h-screen bg-canvas ..."`, but unlike the landing page and /login it is not the top-level content: app/super-admin/layout.tsx renders an inline-styled header (padding 18, so roughly 60px tall) above it. Total document height therefore becomes header height plus 100vh, so the requests page always scrolls by about 60px even when it shows the empty state. The sibling super-admin pages do not do this.
- **Fix:** Drop min-h-screen at app/super-admin/requests/page.tsx:54, or replace it with an explicit arbitrary value that accounts for the shell header, e.g. `min-h-[calc(100vh-60px)]`.

### Super-admin requests page hand-rolls Container instead of using it

- **Lens:** consistency  
- **Where:** app/super-admin/requests/page.tsx:57-58
- **Problem:** The page writes `px-4 ... md:px-8` on the outer div and `mx-auto w-full max-w-6xl` on the inner one. That is character-for-character the base of components/Container.tsx:5, split across two elements. Container exists precisely to own the page max-width and gutter, and it is used by all six landing sections. If the shared width or gutter ever changes, this page silently keeps the old values and drifts from every other design-system page, with nothing in the type system or a test to catch it.
- **Fix:** Import Container and replace the two divs with `<div className="ds min-h-screen bg-canvas py-8 font-sans text-ink"><Container>...</Container></div>`. This also removes the only place in the branch where the design-system page gutter is duplicated.

### Field and Textarea are duplicated wholesale and the comments have already diverged

- **Lens:** consistency  
- **Where:** components/Field.tsx:26-64, components/Textarea.tsx:26-55
- **Problem:** Everything except the control element is identical: the hintId/errorId derivation, the wrapper div, the label, the aria-describedby and aria-invalid wiring, and both the hint and error paragraphs. The duplication has already started to rot: the substantive rationale for using a plain <p> rather than role="alert" lives only in Field.tsx:54-58, and the full WCAG 1.4.11 measurement for border-ink-3 lives only in Field.tsx:38-42 with Textarea.tsx:38 reduced to "for the same reason as Field". A future accessibility fix applied to one will not reach the other, and nothing fails if it does not.
- **Fix:** Extract a `FieldShell({ id, label, hint, error, wrapperClassName, children })` in components/FieldShell.tsx that owns the wrapper, label, id derivation and the hint/error paragraphs plus their comments, and returns the describedby string. Field and Textarea then reduce to their own element plus the shared class string, which stays type-safe because each still spreads its own element-specific HTML attributes.

### Badge is the only primitive with no className prop and no named Props type

- **Lens:** consistency  
- **Where:** components/Badge.tsx:18
- **Problem:** Button, Container, Field and Textarea all accept className (Field and Textarea additionally accept wrapperClassName, and each documents which element it targets). Badge accepts only tone and children, and types them inline in the signature rather than with a `type Props` like its four siblings. The first consumer needing to nudge a badge's spacing has to either edit the primitive or wrap it in a div, and the inconsistency reads as an oversight rather than a decision, so the next person will not know whether adding className is allowed.
- **Fix:** Either add `className?: string` fed through cn() with a named `type Props` for symmetry with the other primitives, or add a one-line comment stating that Badge deliberately takes no className because its padding and radius are fixed by the token scale. Given cn() composes only, the comment is the more honest option, but pick one and say so.

### Read-before-editing comments still describe two ds pages and reference a plan task number

- **Lens:** consistency  
- **Where:** app/globals.css:9, tailwind.config.ts:26-29
- **Problem:** globals.css:9 says the reset is scoped to "the '.ds' wrapper that the landing and /login apply to their root element". There are now three: app/page.tsx:20, app/login/page.tsx:62 and app/super-admin/requests/page.tsx:57. Someone auditing the blast radius of a reset change from this comment will miss the super-admin page. tailwind.config.ts:26-29 is written in the future tense about work that is done ("From Task 9 this becomes belt-and-braces, because the landing and /login will carry class='ds'") and anchors itself to a plan task number that means nothing outside the plan document. Both comments are otherwise accurate: the :where() specificity reasoning, the safelist rationale, the layout.tsx seam description and the boxShadow DEFAULT note all still match the code exactly.
- **Fix:** In globals.css:9 replace "the landing and /login" with "the design-system pages (currently /, /login and /super-admin/requests)". In tailwind.config.ts:26-29 change the tense and drop the task reference: "This is now belt-and-braces, since the design-system pages carry class='ds' and the content scan finds it. Do not delete it: it is the insurance for the case where the class is composed at runtime, which the scanner cannot see."

### Two component roots with no stated rule for which to use

- **Lens:** consistency  
- **Where:** components/ vs app/components/
- **Problem:** The repo now has app/components/AppHeader.tsx (legacy, inline-styled, client) alongside the new top-level components/ (design system) and components/landing/ (page-specific). The components/ versus components/landing/ split itself is coherent: components/ holds the five reusable primitives, components/landing/ holds the six single-use page sections, and only Container, Badge and buttonClasses cross the boundary. What is not documented anywhere is why app/components/ also exists and that nothing new should go there. Neither the guide's file table (docs/landing-redesign-guide.md:69-98) nor the plan's file structure mentions app/components/ at all.
- **Fix:** Add one row to the guide's primitives table or a sentence under it: "app/components/ holds the legacy inline-styled AppHeader and is frozen. New shared components go in components/, new single-page sections in components/<page>/."

### Handover guide describes the pre-Supabase version of the request-access flow

- **Lens:** product  
- **Where:** docs/landing-redesign-guide.md:145-154
- **Problem:** docs/landing-redesign-guide.md:145 still shows the flow as "RequestAccessForm -> POST /api/request-access -> Zod validation -> Resend", omitting the Supabase insert that commit f17a507 made the system of record. Line 151-154 states "Missing config returns a deliberately vague 500 to the client", which is now false for the email config: app/api/request-access/route.ts:118-121 returns 200 when Resend variables are absent. This is the document the next person reads to understand the failure modes, and it currently tells them mail failure surfaces as an error when it silently does not.
- **Fix:** Update the flow line to "-> Zod validation -> insert into registration_requests (service role) -> best-effort Resend notification" and rewrite the config paragraph to state that missing Supabase config returns 500 while missing Resend config returns 200 with only a server-side warning.

### Rate limiter counts validation failures, so a fumbling genuine visitor gets locked out

- **Lens:** product  
- **Where:** app/api/request-access/route.ts:44-51, app/api/request-access/route.ts:30-42
- **Problem:** app/api/request-access/route.ts:46 runs isRateLimited before the body is even parsed, so every 400 from a validation error and every honeypot hit consumes one of the five requests per IP per minute. Haulage offices commonly sit behind a single NAT IP, so two people filling the form from the same office plus a few validation mistakes can produce "Too many requests. Please try again shortly." for a real prospect. Once over the limit, each further attempt is still pushed onto the array (line 39-41), so continued clicking keeps the window rolling and the visitor is locked out longer than a minute.
- **Fix:** Move the rate-limit counter to after successful validation, or count validation failures against a separate, more generous budget. Also stop pushing the timestamp once the limit is already exceeded, so the window actually expires rather than being extended by retries.

### Unverified compliance and data claims in the hero trust line

- **Lens:** product  
- **Where:** components/landing/Hero.tsx:86-88
- **Problem:** components/landing/Hero.tsx:87 renders "Built for UK and EU operators · WCAG 2.1 AA · Your data stays yours". "WCAG 2.1 AA" is a formal conformance claim published on a commercial homepage with no audit or accessibility statement behind it, and "Your data stays yours" is a data-handling promise with no privacy policy behind it (see the dead Privacy link). Accessibility conformance claims are increasingly checked in public-sector and large-shipper procurement, and an unbacked one is worse than none.
- **Fix:** Replace with claims you can defend on day one, e.g. "Built for UK and EU operators · UK-hosted data · No setup fee", and move the accessibility claim to a real accessibility statement page once an audit exists.

### .gitignore committed with duplicated UTF-16 content, so git treats it as binary

- **Lens:** product  
- **Where:** .gitignore
- **Problem:** The .gitignore in this branch starts with UTF-16LE encoded lines ("n\0o\0d\0e\0_\0m\0o\0d\0u\0l\0e\0s\0/") followed by ASCII duplicates of the same entries. `file` reports it as `data` and git shows it as a binary diff (Bin 254 -> 609 bytes in the diffstat), which is why the change is unreviewable. The ASCII half parses correctly, so behaviour is fine today (git check-ignore confirms .env* and next-env.d.ts resolve), but the UTF-16 half is dead bytes and any future edit through the same PowerShell redirect will compound it.
- **Fix:** Rewrite .gitignore as plain UTF-8 without BOM, keeping only the ASCII entries including the `!.env.example` negation, so the file diffs as text.

### Minor spec deviations: mobile nav CTA is 40px not 44px, and the Section primitive was not built

- **Lens:** product  
- **Where:** components/landing/LandingNav.tsx:43
- **Problem:** Spec section 9 states "Primary actions use Button size lg (at least 44px touch target) on mobile", but the mobile Get started CTA at components/landing/LandingNav.tsx:43 uses size "md", which is h-10 = 40px. The guide acknowledges this at docs/landing-redesign-guide.md:186. Spec section 8 also lists a `Container / Section` primitive; only Container was created. Neither is a functional problem, but the mobile CTA is the highest-intent tap on the page.
- **Fix:** Change LandingNav.tsx:43 to buttonClasses("primary", "lg") for the mobile branch only, matching the 44px menu button beside it. Drop Section from the spec's component table or add it.
