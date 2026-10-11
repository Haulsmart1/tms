# TMS Wizard SEO audit and implementation

Audit date: 9 October 2026. Repository: `Haulsmart1/tms`. Safe baseline: `0bf41dc4d597602223ade09c8878aac6e9f2c397`. All work is confined to `C:\Users\StuartDargue\tms-seo-development`, branch `seo/tms-wizard`.

The initial SEO and Contact work is now committed as `14d8ac2`. The subsequent public brand phase starts from that clean commit. See [brand audit and application evidence](brand-upgrade.md) and [current validation/commit manifest](validation.md). Findings below describe the original SEO baseline and implementation history.

## Evidence and limits

Reviewed README product inventory, public page/component source, public auth allowlist, proxy matcher, legal metadata/content status, billing rate card, shell behaviour and route classification tests. Checked implementation paths for jobs, POD and accounts before writing feature content. No production credentials, customer data, SQL, authenticated driver workflows or external mutations were used.

The live origins could not be reached from this session: web browsing could not retrieve either spelling, shell HTTPS could not connect to `tmswizard.cloud`, and `tmswizzard.cloud` did not resolve in the restricted shell. These are environment observations, not evidence of a production outage. Search Console, analytics, server logs, backlink data and CrUX were not available. No ranking, traffic, search-volume or field Core Web Vitals claims are made.

The user specifies **TMS Wizard / https://tmswizard.cloud**, with official public contacts **support@tmswizard.com / 0800 999 1263**. Older README and UI source use **TMS Wizzard / tmswizzard.cloud**. Canonicals, sitemap, social metadata and marketing chrome use the user-specified identity. Before any separately authorised release, verify the owned primary domain and redirects from alternate hostnames. This branch does not alter auth callback origins, customer link generation or source legal documents. Displayed policy contact addresses use the official email through a narrow rendering substitution.

## Baseline findings

| Area | Finding | Priority / response |
| --- | --- | --- |
| Public inventory | Homepage plus `/legal` and ten policy pages; `/login`, `/signup`, `/auth/confirm` are auth utilities; token POD, quotation and tracking links are customer documents, not marketing | Preserve this distinction; add only narrowly scoped static marketing pages |
| Index controls | Root metadata has no robots policy; only tracking links and draft legal documents explicitly opt out | P0: noindex by default, exact public opt-ins, noindex response header for everything else |
| Authentication | Exact public allowlist with narrow token patterns; operational pages remain authenticated; proxy excludes dotted static paths | Retain auth logic and matcher; cover dotted token paths and PDFs with config headers independently |
| Discovery | No `robots.ts`, robots.txt or sitemap source found | P1: crawlable robots and an XML sitemap containing only canonical marketing/published policies |
| Canonicals | No canonical metadata found | P1: page-specific absolute URLs; no inherited homepage canonical on private routes |
| Titles / descriptions | Root says “TMS Wizzard”; homepage description duplicates a hardcoded price; policies lack social metadata | P1: consistent public identity and distinct descriptions; central metadata helper |
| Structured data | Homepage has server-rendered SoftwareApplication, but hardcodes price and product identity | P1: derive offer from rate card; retain server rendering; add WebSite and visible breadcrumbs |
| Content | One broad marketing page, short feature cards, little explanation of office → driver → accounts handover | P2: feature hub, three substantive workflow pages and one selection guide |
| Claims | “Real-time positions” and “Stay road-legal” overstate documented partial tracking/compliance features | P1: describe latest available positions and records; avoid compliance guarantees |
| Navigation | Homepage anchors only; public CTAs lead to signup although signup is closed by default | P2: feature navigation, related links, guide links; request-access CTAs use existing public form |
| Mobile | Hero mock's four-column table and header actions risk crowding on narrow screens; homepage has no skip link | P2: responsive mock columns, narrow-screen actions in menu, reusable skip link |
| Performance | Root always mounts tenant provider, billing banner and app shell on public pages, importing auth/application code and initiating tenant resolution | P2: defer existing application frame for public marketing and policy pages |
| Images | Homepage uses a code-native illustrative mock, decorative SVG logo and icons; the large public JPEGs are not used by public marketing components | Do not add stock hero imagery; retain accessible mock label and decorative icon semantics; add cached code-native social artwork |
| Policies | Content is generated from PDFs; draft status governs noindex | Retain wording and draft logic; sitemap filters drafts automatically |

## Search intent and site architecture

This is a multi-tenant cloud TMS for UK/EU road-haulage operators. The documented core solves booking/assignment coordination, delivery-evidence retrieval and customer billing. It is not a generic warehouse, parcel carrier or enterprise supply-chain platform.

| Public path | Intent / distinct purpose | Product evidence |
| --- | --- | --- |
| `/` | Transport management software / haulage software overview, pricing and Contact CTA | README “What it does”, landing pricing from `lib/billing/pricingCopy.ts` |
| `/contact` | Software enquiries, access requests and customer support; official email/telephone and FormSubmit form | User-supplied contact facts; [Contact implementation](contact.md) |
| `/features` | Explore connected transport workflows | README page inventory; feature page links |
| `/features/transport-job-management` | Job booking, multi-stop work, vehicle/driver assignments and load manifests | `app/jobs/page.tsx`, `app/planning/page.tsx`, README Operations; no seven-day feature promised |
| `/features/electronic-proof-of-delivery` | Recipient/photo/document evidence, office retrieval and customer sharing | `app/pod/page.tsx`, `app/driver/jobs/[jobId]/page.tsx`, `lib/pod/shareLinks.ts`; offline claims qualified by README rollout caveats |
| `/features/transport-invoicing` | Customer invoices, payments, statements and accounting handover | `app/api/accounts/`, Xero invoice-sync routes, README Commercial; no promise of arbitrary accounting integrations |
| `/guides/choosing-transport-management-software` | Practical buying checklist, including when spreadsheets remain suitable | Original editorial guidance tied to real product workflows; no competitor claims or invented results |
| `/legal` and published policy paths | Trust and contractual information | Existing generated documents; wording unchanged |

Homepage → feature hub → workflow detail → related workflow/guide → pricing/Contact is the intended public journey. All of these pages have crawlable HTML links. No operational route is used as a marketing link or added to the sitemap. The guide links to the relevant public feature and policy pages. The footer makes Contact, the feature hub and guide discoverable from public pages.

These are relevance hypotheses based on the actual product, not claims of measured keyword demand. Do not add location pages, “best TMS” claims, competitor comparisons, screenshots presented as real customer data, reviews, ratings, fabricated case studies or savings figures. Existing mock job rows remain explicitly labelled example data.

## Implemented batches

1. **Indexing and metadata:** default private metadata; independent noindex headers including PDFs/API/redirects; public metadata helper with canonicals, OG/Twitter; robots and sitemap; legal draft exclusion; rate-card-backed SoftwareApplication and WebSite data.
2. **Useful public content and discovery:** feature hub, jobs/POD/invoicing pages with visible FAQs and review checklists, buying guide, homepage questions, navigation and internal links. No FAQ rich-result eligibility is implied; visible FAQs are not marked up merely to seek rich results. Breadcrumb JSON-LD matches visible breadcrumbs.
3. **Public performance and mobile:** public pages no longer mount the tenant provider/billing sidebar; existing app frame is loaded for application/auth/token routes. Marketing content remains server-rendered. Responsive hero and navigation, skip link, accessible social-image description, static cached 1200×630 image route without external assets.
4. **Contact and homepage consolidation:** a static Contact page with a validated, accessible FormSubmit form and native fallback; official phone/email in the homepage, Contact page and footer; all enquiry links updated; legacy homepage form removed. Public Contact is in the sitemap; the native return page stays noindex. Rendered policy emails use the official address, with a current website-provider notice on the privacy/sub-processor pages. No real enquiry or activation request was sent; [activation and implementation notes](contact.md) record the remaining external dependency.

## Crawl and privacy policy

Robots allows crawling so engines can read `noindex`. Blocking the same URL in robots would prevent a crawler from seeing the removal directive. Authentication and token checks, not robots, protect customer data. Login/signup/confirmation and every route outside the exact public document list receive `X-Robots-Tag: noindex, nofollow`; root metadata supplies the equivalent HTML default. A future operational route is protected from indexing without someone maintaining a denylist. Public access and search indexing have separate allowlists.

The header exception for legal routes does not force them indexable: draft document metadata still explicitly opts out. The sitemap contains no auth, customer, driver, planning, invoice, POD-share, quotation-share, tracking-token or API URLs. No fake `lastmod` timestamps or sitemap priority promises are added.

References checked for implementation decisions: [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [Next metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [Next robots](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots), plus installed Next docs for headers, sitemap, ImageResponse and lazy loading. Installed version resolved from the lockfile is Next 16.4.0.

## Validation and handoff

See `validation.md` for final results and commands. Regression tests use Next's real header-route parser and check indexing/auth remain independent. HTTP checks assert rendered metadata, H1s, JSON-LD, token/PDF headers, auth redirects, sitemap content and social-image dimensions. Browser checks cover public pages at 320, 375, 768 and 1440 px, overflow, navigation, keyboard entry and unwanted application data requests.

The initial staging attempt was blocked by shared Git metadata permissions; that work was subsequently committed externally as `14d8ac2`. Current brand-phase commit status and the exact remaining file manifest are recorded in `validation.md`. No push or deployment is authorised by this task.

## Next evidence-led improvements

1. After release is separately authorised, verify production primary host/redirect chain, Googlebot responses, canonical URLs and all public URLs returning 200. Do not infer this from localhost.
2. Submit the sitemap through an owned Search Console property and review index coverage/URL Inspection. Investigate auth/token URLs appearing in search with the owner; use removal tools only if separately authorised.
3. Gather mobile field LCP/INP/CLS and lab measurements with the real fonts and production network. Local mocked-font checks do not certify Core Web Vitals. Optimise against the measured bottleneck.
4. Compare impressions and query intent for the existing feature pages before adding content. Prioritise useful explanations of supported workflows over increasing page count.
5. Add tracking, fleet maintenance or subcontractor feature pages only after verifying deployed feature readiness and integration configuration. Do not market incomplete tachograph sync, universal offline operation, HGV routing or legal-compliance automation.
6. Revisit screenshots and case studies only with permission, sanitised data and verifiable claims. Keep software offer data tied to the rate card.
