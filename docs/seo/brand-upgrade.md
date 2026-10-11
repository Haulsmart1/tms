# Public brand upgrade

Worktree: `C:\Users\StuartDargue\tms-seo-development`. Branch: `seo/tms-wizard`. Baseline: `14d8ac2`.

## Audit and direction

The baseline homepage was a compact heading, three-row sample table, eight equal feature tiles, a pricing card and questions. It communicated an inventory but gave little sense of a transport office's handovers. Feature pages were narrow long-form articles; the guide lacked a contents list. Contact was functional and accessible. Legal documents used a separate header. Login/signup/confirmation screens used compact console-style cards. The social preview used unrelated generic dark-blue artwork.

Audited every public route and shared renderer: homepage, feature hub and all three feature details, guide, Contact and native thank-you, legal index and all ten policy documents through LegalPage, login, both signup gate states, and auth confirmation. Operational/customer-token surfaces are private utilities, not marketing pages, and retain their current presentation and indexing boundaries.

Direction: a dispatch-office visual language, using warm paper, deep green-black ink, the existing blue dispatch-arrow mark, restrained pale-green accents, numbered handovers and route markings. IBM Plex Sans and Mono remain the fonts. No photographs, remote artwork, new packages, gradients behind text, fake customer logos or invented endorsements. The hero illustrates supported records and explicitly says it is illustrative example data, not a screenshot or a live record. The design does not pretend this diagram is a pixel-identical product interface.

The homepage is rebuilt around the actual journey: booking and assignment → delivery evidence → accounts. Separate records/access and pricing sections explain what to check before rollout. Contact remains the primary conversion path. Legal/privacy/accessibility links provide evidence without claiming certification or guaranteed compliance.

## Application evidence

Read the actual page implementations, form/board components and existing product audit. No authenticated session or real customer records were opened.

| Published capability | Evidence in this checkout | Boundary retained |
| --- | --- | --- |
| Collection/delivery stops, instructions, vehicle/driver assignments | `app/jobs/page.tsx`, `app/jobs/JobForm.tsx`, `app/planning/page.tsx`, `app/planning/VehicleLane.tsx` | No compliant-route guarantee; assignment changes still need communication |
| Load manifests and item scanning | `app/jobs/MasterLoadBuilder.tsx`, existing driver job implementation | No changes to driver/PWA code; scanning needs device validation |
| Recipient details, photos, delivery documents and stop-level POD | `app/pod/page.tsx`, `lib/pod/savePod.ts` | Completion and evidence are separate; no universal offline promise |
| Withdrawable customer POD links and time-limited private file access | POD sharing/revocation UI and `lib/pod` file/share helpers | Links are sensitive, private and excluded from search |
| Invoices, credit notes, payment records, statements, chase letters | `app/invoices/page.tsx` and accounts helpers | No guaranteed collection, automatic payment or savings claim |
| Xero invoice sync | `lib/accounts/providers/xero.ts`, `lib/accounts/xeroTax.ts`, accounting endpoints | Setup and mapping must be checked with the customer's accounts team |
| Vehicle, driver and maintenance records | `app/vehicles/page.tsx`, `app/drivers/page.tsx`, `app/maintenance/page.tsx` | Records assist the operator; no regulatory certification claim |
| Pricing | `lib/billing/rateCard.ts` through `pricingHeadline()` / `pricingBandRows()` | No new price, discount or billing-period invention |

## Reusable system and preserved behaviour

`brand.css` is scoped to `.tms-brand`, overriding tokens inside public shells only. Root/operational tokens and application components are untouched. `Brand.tsx` supplies Wordmark, SectionHeading and PageIntro. MarketingShell provides the shared accessible frame; LegalShell delegates to it. AuthSurface wraps existing forms without changing handlers, signup gating, tokens or callback validation. ProductBoard, WorkflowStory and OperationalConfidence are server-rendered and make no requests. The mobile nav supports Escape and returns focus to its toggle. Long guides have an anchored contents list; legal tables retain labelled keyboard-scroll regions and print styles.

Existing metadata, canonical origin, robots, sitemap, private headers and route allowlists are preserved. The FormSubmit code, recipient, native fallback, spam handling and success/error logic are unchanged. Official contacts remain `support@tmswizard.com` and `0800 999 1263`. Legal source text/PDFs remain unchanged. No operational work, Driver PWA, SevenDay or Load Transfer implementation is modified.

## Validation and release boundaries

Results and the final commit manifest are recorded in `validation.md`. Local browser checks block remote requests and intercept FormSubmit before transmission. No real enquiry, authentication email, customer operation or production-data change is permitted in this validation. FormSubmit activation/live delivery and actual authenticated workflows remain separate checks.

The test-only font fixture does not validate the production IBM Plex rendering. Check final production fonts, mobile Safari/VoiceOver, Android TalkBack, keyboard/high-zoom use and field Core Web Vitals during a separately authorised release. Existing font-download restrictions and the historical domain spelling still need release verification.
