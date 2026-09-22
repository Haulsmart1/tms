# Handoff: UK legal and policy pages for TMS Wizzard

Date: 2026-09-17
Branch reviewed: `feat/self-serve-signup` at `8ce53ae` (everything on `main` plus the unmerged self-serve signup work).
Audience: the legal adviser drafting the Terms and Conditions, Privacy Notice, Cookie Notice, Cancellation and Refund Policy, Data Processing Agreement (DPA), Accessibility Statement and (optionally) a Service Level Agreement; and the engineer who will build what those documents need.
Status: **analysis only. No code was changed.** Section 12 lists the engineering work the documents depend on, in order.

How this was produced: a static read of the whole repository (database migrations, API routes, pages, configuration, bundled third-party code) plus the ICO and legislation sources in section 15. Nothing was checked against the live Supabase project or the Vercel dashboard. Every "confirm in production" note below is a fact the code cannot settle.

---

## 1. Summary for the legal adviser

**What the product is.** TMS Wizzard is a multi-tenant, browser-based Transport Management System sold to UK and EU road-haulage operators. A customer ("company") signs up online, adds a payment card, activates vehicles and is billed every 28 days. Customers use it to run jobs, capture proof of delivery, invoice their own customers, track drivers' hours and compliance, and see live vehicle positions. It is sold to businesses only. There is no consumer-facing sale.

**What exists today.**
- No legal or policy pages exist in the product. The signup form already says "By continuing you agree to our terms and privacy notice" and links to `/terms` and `/privacy`; both links currently bounce to the login screen.
- No vendor identity appears anywhere: no legal entity name, company number, registered office, VAT number, ICO registration or contact address. The product's own legal entity is not recorded in the repository (open question 14.1).
- A working cancellation API exists with a **48-hour goodwill refund** window measured from the first payment, but there is no cancel button in the interface, so a customer cannot trigger it.
- Everything stored on the visitor's device is first party and strictly necessary. No analytics, no advertising, no cookie banner.
- No data deletion, export or retention mechanism exists, and several database rules deliberately prevent deletion.

**Corrections to the brief.** Four points in the request need adjusting before drafting starts. Each is expanded in section 2.
1. The 14-day right to cancel in the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 applies only to contracts between a trader and a **consumer**. TMS Wizzard contracts with businesses, so no statutory cancellation right arises. A 14-day right can still be offered contractually, and the code already offers 48 hours. Section 11 sets out how to implement 14 days if you decide to.
2. The UK has **both** the UK GDPR and the Data Protection Act 2018. The UK GDPR is the retained regulation and holds the main obligations (Articles 13, 28, 30 and so on); the DPA 2018 sits alongside it and supplements it. The Data (Use and Access) Act 2025 amended both, and PECR, with most changes in force from 5 February 2026.
3. An accessibility statement is a statutory duty only for public-sector bodies. A private company has the reasonable-adjustments duty under the Equality Act 2010, and a statement is best practice. The sharper issue here is that the landing page already claims "WCAG 2.1 AA", which the codebase's own tests do not support (section 9).
4. A Service Level Agreement is not legally required. The Terms should at least say what uptime and support are, or are not, promised.

**What the drafting cannot proceed without** (section 14): the vendor's legal identity, the hosting regions for Supabase and Vercel, whether the vendor is VAT registered, and the decisions on cooling-off scope and retention periods.

---

## 2. Legal framework as understood, for you to confirm

This section records the legal understanding the analysis relied on. It was checked against the sources in section 15, but it is not legal advice; the point of this handoff is for you to confirm or correct it.

### 2.1 Consumer Contracts Regulations 2013 and the 14-day right

The regulations apply to contracts between a trader and a consumer, a consumer being an individual acting wholly or mainly outside their trade, business, craft or profession. Business customers have no general cancellation right. A sole-trader owner-driver buying fleet software is acting for business purposes and is not a consumer.

Consequences for drafting:
- No statutory 14-day cancellation right or pre-contract information duty under these regulations. The Terms can state a contractual cooling-off period of the business's choosing, or none.
- If a contractual cooling-off period is granted, the consumer mechanics (express request to start the service early, paying a proportionate amount for service used) are a sensible model, but they are a matter of contract, not statute.
- The Digital Markets, Competition and Consumers Act 2024 subscription regime is also consumer-only and, per the April 2026 government response, is not expected to commence before spring 2027. It does not apply to this product, but a footnote is worthwhile in case the product is ever sold to individuals.

### 2.2 Data protection: UK GDPR, DPA 2018 and the Data (Use and Access) Act 2025

The UK GDPR provides the core rules; the DPA 2018 supplements it (Schedule 1 conditions for special category and criminal-offence data, exemptions, the ICO's functions). The DUAA 2025 made targeted amendments in force from 5 February 2026: recognised legitimate interests, a reworked automated decision-making regime (Articles 22A to 22D), a "reasonable and proportionate search" limit on subject access requests, PECR fines raised to UK GDPR levels, and a consent exemption for certain first-party analytics and functionality cookies. The ICO also updated its international transfer guidance in January 2026.

Roles in this product:
- **The vendor is a processor** for the operational data each customer company loads (drivers, customers, delivery addresses, positions, proof of delivery). The customer company is the controller. This is the relationship the DPA must cover (Article 28(3)).
- **The vendor is a controller** for its own data: platform user accounts and sign-in records, billing records, website leads, signup applicants, support correspondence, and the rate-limit and audit logs it keeps for security.
- One integration makes the picture three-layered: an inbound webhook from a manufacturer (Cambridge Audio) delivers **members of the public's** names, home addresses, phones, emails and product serial numbers into one customer's tenant for returns collections. The customer (ADR Carriers) is a processor for the manufacturer; the vendor is a sub-processor. See 4.4.

### 2.3 PECR and cookies

Regulation 6 requires clear information and consent for storage on, or access to, a user's device unless strictly necessary for a service the user requested. Since 5 February 2026 first-party analytics used solely to improve the service are also exempt, provided users are informed and can object. The product uses no analytics. The information duty still applies to strictly necessary storage, so a cookie notice (or a section in the privacy notice) is still required; a consent banner is not, subject to the two open items in 6.3.

### 2.4 Equality Act 2010 and accessibility

The Public Sector Bodies (Websites and Mobile Applications) Accessibility Regulations 2018 require a statement and WCAG conformance from public-sector bodies only. A private service provider owes the anticipatory reasonable-adjustments duty under the Equality Act 2010; WCAG 2.2 AA is the accepted benchmark for meeting it. A statement is voluntary but recommended, and it must be truthful (section 9).

### 2.5 Vendor identity on the website

The Company, LLP and Business (Names and Trading Disclosures) Regulations 2015 (company name, registration number, place of registration, registered office on websites) and the Electronic Commerce (EC Directive) Regulations 2002 regulation 6 (name, geographic address, email, VAT number where registered) are the usual sources for the identity block in the footer and in the Terms. Please confirm which apply to the vendor's entity type.

### 2.6 EU AI Act

Not engaged. The codebase calls no AI or machine-learning service and makes no automated decisions with legal or similarly significant effect. Route optimisation is deterministic heuristic code. A DPA clause on automated decision-making can say so.

---

## 3. Parties, roles and where the data lives

| Party | Role in data-protection terms | Notes |
|---|---|---|
| The vendor (legal entity unknown, trading as "TMS Wizzard") | Controller for accounts, billing, leads, security logs. Processor for customer operational data. | The repository contains no legal name. The only identity signals are a lead inbox at an `adrcarriers.net` address and a hard-coded "ADR Carriers" tenant in one integration. |
| Customer company (haulage operator) | Controller of drivers', customers', consignees' and subcontractors' data. | Signs up online; the founding user is an "admin". A company owns one or more "tenants" (depots or divisions). |
| Company staff (admins, office users) | Data subjects (their own account) and the people who load everyone else's data. | Passwordless magic-link login. |
| Drivers | Data subjects, highest risk. | Employees of the customer, with a driver app that sends live GPS. Not usually users of the console. |
| Customer's customers, consignees, recipients | Data subjects. | Names, addresses, phone numbers, who signed for goods, photos. Reached through proof-of-delivery share links and emailed PDFs. |
| Subcontractors and their staff | Data subjects. | Owner-drivers are sole traders, so their record is a personal file. |
| Website leads and signup applicants | Data subjects of the vendor. | Two intake forms on the landing page. |
| Cambridge Audio's end consumers | Data subjects three layers removed. | Delivered by webhook, stored verbatim. |

Hosting: Supabase (Postgres database, authentication, file storage) and Vercel (application hosting, serverless functions, daily cron). **Neither region is pinned in code or documented.** Both must be read from the respective dashboards and stated in the privacy notice and DPA (14.2).

---

## 4. Personal data inventory

The tables below are condensed from a column-level sweep of every migration and every database call in the application. Column-level detail with file references is in Appendix A. Two caveats: the base tables were created in the Supabase dashboard and their definitions are reconstructed from code, so the live schema should be dumped (a read-only script exists for this) before final drafting; and 12 compliance tables exist as empty stubs with no code reading them, whose production contents are unknown.

### 4.1 Vendor-as-controller data

| Data | Fields | Where | Retention today |
|---|---|---|---|
| Platform accounts | Email, sign-in timestamps, IP address and user agent of sessions (kept by Supabase Auth) | `auth.users`, `auth.sessions`, `auth.audit_log_entries` | Indefinite. Removing a user from a company keeps their name, phone, email and auth record. |
| Profiles | Full name, phone, role, company and tenant | `profiles`, `public.users` | Indefinite |
| Billing | Square customer id, card token id, card brand, last four digits, expiry; every charge with amount, VAT, Square payment id and receipt link | `company_billing`, `platform_charges`, `period_charges`, `billing_periods` and related | Indefinite by design (VAT and payment evidence; deletion blocked by a database rule) |
| Website leads | Company, contact name, email, phone, vehicle count, free-text notes | `registration_requests` | Indefinite; **no deletion is possible through the API for any role** |
| Signup applicants | Company name, contact name, email | Creates the company and admin account directly | As accounts |
| Security logs | Rate-limit keys (client IP or lower-cased email) | `rate_limit_hits` | Rows older than one day deleted opportunistically (the only time-based deletion in the system) |
| Super-admin audit | Actor id, action, field names (values deliberately excluded) | `super_admin_audit` | Append-only; cannot be deleted through the API |
| Server logs | IPs, paths, some identifiers logged by routes (stop ids, postcodes, lead context) | Vercel function logs | Vercel default |

### 4.2 Customer operational data (vendor as processor), by data subject

**Drivers** (employees of the customer). The `drivers` table is the largest concentration of personal data in the system and includes several high-risk categories:
- Identity and contact: name, phone, email, employee number, **date of birth**, **home address**, start and end dates, free-text notes.
- **Emergency contact name and phone** (a third party with no relationship to the vendor).
- Driving licence: number, dates, categories, restriction notes, licence check references and **DVLA share codes**.
- **Motoring-offence data**: penalty points, disqualification and dates; endorsement codes with offence and conviction dates. This is criminal-offence data under UK GDPR Article 10 and needs a DPA 2018 Schedule 1 condition and an appropriate policy document on the controller's side.
- **Health data**: medical dates and a free-text "medical restrictions" field. Special category data under Article 9.
- **Right-to-work** check dates and references (immigration status).
- Tachograph card number and status, Driver CPC, ADR certificate details, training records.
- **Continuous location**: the driver app sends a GPS fix at most every 15 seconds while tracking is on, attributed to one named driver via the vehicle assignment. Stored indefinitely with no aggregation or purge. Scan events and planned routes also carry coordinates.
- **Working-time records**: driving, other work, availability, break and rest activities (manual and imported from a tachograph provider), ferry and train crossings with rest intentions.

**The customer's customers and delivery recipients**:
- Customer companies with named contacts (name, job title, phone, mobile, several emails, out-of-hours contact), addresses, credit terms and free-text instructions.
- Every job stop: address, postcode, coordinates, the **name of the person who signed for the goods**, delivery notes, timestamps.
- Proof-of-delivery **photographs** of goods, premises and paperwork, and delivery documents, in a private storage bucket. The evidence type list still includes "signature" although uploads are restricted to photo and document today; confirm no legacy signature files exist.
- Quotations, invoices, credit notes, statements and debt-chasing letters about named customers; payment records with bank references.
- Public quote-request forms that retain the **entire raw submitted body** alongside the normalised fields.

**Third parties who open a share link or accept a quotation**:
- POD share links record the recipient email and last-viewed time.
- Quotation acceptances record the acceptor's name, email, company, position, **IP address and user agent**, plus a frozen copy of the terms they accepted. This is the only table that stores IP addresses of data subjects. It is immutable by design as contract-formation evidence, so its retention period must be justified explicitly.

**Subcontractors**: company or sole-trader identity, operator licence, four insurance policy numbers, contact name, phone, email, address, emergency contact, employees with employment dates, vehicles with registrations.

### 4.3 Special category, criminal-offence and high-risk data (for the DPIA and the DPA)

| Category | Where | Legal hook |
|---|---|---|
| Health | Driver medical dates and free-text medical restrictions | UK GDPR Art. 9; DPA 2018 Sch. 1 condition needed by the controller |
| Criminal offence | Penalty points, disqualifications, endorsements with offence and conviction dates, licence check results | UK GDPR Art. 10; DPA 2018 Sch. 1 and appropriate policy document |
| Immigration status | Right-to-work check dates and references | High risk, not Art. 9 |
| Worker location monitoring | GPS trail per named driver, scan-time coordinates, planned routes | ICO employment monitoring guidance; DPIA trigger |
| Working-time monitoring | Drivers' hours ledger, tachograph card numbers, ferry and train rest records | Likely legal-obligation basis for the controller (Regulation (EC) 561/2006, drivers' hours and working time rules) |
| Employee identity | Date of birth plus home address | Identity-theft risk |
| Third-party contacts | Emergency contacts for drivers and subcontractors | No direct relationship; transparency by the controller |
| Online identifiers | IP and user agent on quotation acceptances; IP or email in rate-limit keys; Supabase auth session records | |
| Payment data | Card tokens and fragments only; the card number is entered into Square's own iframe and never reaches the vendor's servers | PCI scope minimised; still declare |
| Bank details in free text | Document settings bank details; payment bank references | |
| Members of the public via a B2B webhook | Cambridge Audio returns: name, email, phone, home addresses, serial numbers, stored verbatim | Controller/processor chain needs its own clause |
| Vehicle registration marks | Vehicles, subcontractor vehicles, tracking views | Personal data once linked to a driver |

### 4.4 The Cambridge Audio returns integration

One API route receives a signed webhook from a manufacturer's returns system. The payload (first name, last name, telephone numbers, email, collection and delivery addresses, product serials) is stored **verbatim** in a raw-payload column, then copied into a job whose free-text notes concatenate the consumer's name, phone, email and items, and into job stops carrying the address and recipient name. There is no retention rule for the raw copy. This is the clearest case of processing the customer's customers' data and needs its own treatment in the DPA (sub-processor position, instructions, retention) and in the customer's own privacy notice to those consumers.

---

## 5. Sub-processors and data flows

The README's integrations list is incomplete and partly wrong as a source for the DPA. The table below is what the code actually does.

| Service | Purpose | Personal data sent | Where it runs | Documented today |
|---|---|---|---|---|
| Supabase | Database, authentication, file storage, auth emails | Everything in section 4, including GPS and photographs; sends magic-link and invite emails from Supabase's shared mail relay until custom SMTP is configured | Server and browser (sets the session cookie) | Yes, but no region |
| Vercel | Hosting, serverless functions, daily billing cron, logs | All request traffic, IPs, function logs (some contain postcodes and stop ids) | Server | Yes, but no region |
| Microsoft 365 (Graph API) | Sends invoices, quotations, credit notes, statements, chase letters and proof-of-delivery emails with PDF attachments; a copy is saved to the sender's Sent Items | Recipient email; full PDF content (customer names, addresses, line items, delivery addresses, recipient names, photographs) | Server | **No** |
| Microsoft Teams (Power Automate webhook) | Lead alert card | Lead company, contact name, email, phone, vehicle count, notes | Server | Yes |
| Resend | Lead alert email to an internal inbox | Same lead fields; the lead's email is set as reply-to | Server | Yes |
| Square | Platform subscription billing, card on file, 3-D Secure | Browser: card number, expiry, CVV and postcode typed into Square's iframe, cardholder name for 3DS. Server: company name, company id, card token, charge amounts. Square's hosted receipt is the customer's only receipt | Server and browser (loads `web.squarecdn.com` on the billing page only) | Yes |
| Stripe (Connect) | Lets a customer company take card payments for its own invoices | Company name and tenant id; Stripe collects the operator's identity and bank details directly through Stripe-hosted onboarding | Server | Partly. The secret key is not configured, so the feature currently fails, but the code ships |
| TomTom | Geocoding, routing, distance matrix, map tiles | Server: full stop addresses and postcodes, coordinate lists for a day's route. Browser: map viewport (approximate vehicle locations), operator's IP, public map key | Server and browser (planning, tracking, telematics pages) | Mislabelled as "planned"; it is live |
| postcodes.io (Ideal Postcodes, UK) | Fallback postcode geocoding | UK postcode of a stop | Server | **No** |
| Xero | Accounting sync | Customer name, account code, accounts email; invoice number, dates, references, line items. Request and response bodies are also stored in a local sync log | Server (tokens stored AES-256-GCM encrypted) | **No** |
| Tachograph data provider | Pulls drivers' hours activities for a driver | A driver identifier is sent; activity records come back | Server | No provider is registered in the repository; **confirm which supplier is live** |
| WhatsApp (Meta) | Operator-initiated share of a POD link | Contact phone number and a signed POD link, in a `wa.me` URL opened in a new tab | Browser | No |
| Google Maps | Driver navigation deep link | Full delivery address in the URL | Browser | No |
| Google Fonts | Typeface | None: fonts are downloaded at build time and self-hosted; no runtime request | n/a | n/a |
| Cambridge Audio | **Inbound** returns webhook | Receives consumer data (4.4); sends nothing back | Server | Partly |

Not used: EmailJS is a dead dependency with no code references, but live-looking EmailJS credentials sit in the local environment file. Recommend removing the package and revoking the keys (engineering item). No AI or LLM service is called anywhere.

International transfers: none of the providers' regions are recorded. Supabase and Vercel are the ones that matter most; Microsoft 365, Square, Stripe, Xero and TomTom will each need their standard transfer mechanism cited (UK Addendum to the EU SCCs, the UK-US data bridge with explicit UK-extension enrolment confirmed, or an adequacy regulation). The ICO's January 2026 guidance replaced the "sufficiently similar" test with "not materially lower".

---

## 6. Cookies and device storage

### 6.1 Cookies

| Cookie | Purpose | Set by | Attributes | PECR class |
|---|---|---|---|---|
| `sb-<project-ref>-auth-token` (chunked as `.0`, `.1` when large) | Supabase authentication session: access token, refresh token, expiry | First party, server and browser | Path `/`, SameSite Lax, not HttpOnly (the browser client must read it), 400-day max age, refreshed on rotation. Refreshed on public pages too, including the landing, login and signup pages | Strictly necessary |
| `xero_oauth_state` | CSRF token for the Xero connection round trip | First party, server | HttpOnly, Secure, SameSite Lax, 10 minutes | Strictly necessary |
| `xero_oauth_tenant` | Carries the selected tenant across the Xero redirect | First party, server | HttpOnly, Secure, SameSite Lax, 10 minutes | Strictly necessary |
| Square's own cookies and storage | Payment tokenisation, 3-D Secure and fraud signals inside Square's iframe on the billing page | Third party (Square) | Not controlled by this code; **enumerate from a live billing page** | Strictly necessary for a payment the user initiated; disclose as third party |

### 6.2 Local and session storage (all first party)

| Key | Holds | Lifetime | Class |
|---|---|---|---|
| `tms-theme` | "light" when the user opts out of the default dark theme | Persistent | User preference, strictly necessary |
| `tms.activeTenant.<userId>` | The selected tenant for that user | Persistent | Strictly necessary |
| `tms:quotation-draft:<tenantId>` | Unsaved quotation draft, which can include a prospect's contact details and addresses | 7 days | Strictly necessary (crash recovery). Worth a sentence in the privacy notice: it holds third-party data on a possibly shared depot PC |
| `tms:planning-draft:<tenantId>:<date>` | Unsaved planning board (job ids per vehicle, drivers) | 7 days | Strictly necessary |
| `tms:quotation-viewed:<token fragment>` (session storage) | Once-per-tab flag so a shared quotation counts as one view and email scanners are not counted | Tab session | **Borderline**, see 6.3 |

There is no analytics, tag manager, pixel, service worker, IndexedDB or Cache Storage use anywhere. All storage writes are wrapped so the app works with storage blocked. The bundled TomTom map library descends from mapbox-gl and contains dormant telemetry code; it was traced through the bundle and every path that could write a device identifier or post an event is gated on a Mapbox token the app never sets, so the map stores nothing on the device and sends no telemetry. When a map is shown, the browser does fetch tiles directly from TomTom, disclosing the viewer's IP and the public map key.

### 6.3 Two items to resolve before the cookie notice is final

1. **Quotation view flag on a public page.** The public quotation-share page writes a session-storage flag and records a "viewed" timestamp against the quotation before any consent. It is first party and stores nothing identifying, but it exists to measure whether a named recipient opened a document. Either justify it as essential to the quotation-acceptance workflow (delivery audit trail) and disclose it, or drop the client-side flag.
2. **Square's own storage.** Square's payment iframe is not in this repository. Open the billing page in a browser and list what Square sets, so the notice can name it.

Also relevant: the driver app uses browser geolocation (permission-gated) and the camera for barcode scanning. Neither is a cookie, but both belong in the privacy notice's device-access section.

---

## 7. The commercial lifecycle as the code implements it

### 7.1 Signup and contract formation

- Fields collected: company name, contact name, work email. No address, VAT number, company number, card or vehicle count.
- Price shown before commitment: "From £129.00 per 28 days, including your first 2 vehicles" and "Billed at the end of each 28-day period, for the days each vehicle was licensed. Excludes VAT." Both are derived from the rate card so they cannot drift from the code. The fuller pricing table (volume bands) is on the landing page only.
- Acceptance: a passive sentence, "By continuing you agree to our terms and privacy notice". **No checkbox, no recorded acceptance, no timestamp, no terms version.** Nothing about acceptance reaches the server.
- Contract-formation moment available in data: `companies.created_at` (signup time).
- No trial. No money moves at signup.

### 7.2 Pricing and VAT

Two billing models run side by side. All new companies are on the second.

| | v1 "immediate" (legacy companies) | v2 "period" (all new signups) |
|---|---|---|
| Timing | In advance, every 28 days, plus pro-rata when a vehicle is added mid-cycle | In arrears when a 28-day period closes; a £129.00 minimum is taken when the first vehicle is activated |
| Price | Graduated weekly bands per vehicle: £10, £8, £6, £5 per week | £64.50 per vehicle per period, £129.00 minimum, whole-fleet discounts at 10, 15, 20 and 30 vehicles (10%, 15%, 20%, 22%) |
| Cancellation | Immediate; prepaid cycle runs to its end; **no refund** | Immediate with settlement of days used, or the cooling-off refund (7.4) |

VAT is added at a hard-coded 20% on every charge and all copy says "excludes VAT". **The repository records no VAT registration number for the vendor and no setting for whether it is registered.** If the vendor is not VAT registered, the code is charging VAT unlawfully. Confirm before the Terms quote prices (14.3).

### 7.3 When money moves

1. Signup: nothing.
2. Card save: the card is tokenised in Square's iframe, a Square customer is created with the company name, and a billing row is created. On v2, nothing is charged unless vehicles are already billable. The interface says so: "Nothing is charged today: your first payment, the £129.00 minimum plus VAT, is taken when you activate your first vehicle for billing."
3. First vehicle activation: the £129.00 minimum plus VAT is charged and the first 28-day period opens, **anchored to that day, not to signup**.
4. Period close (daily cron at 06:00 UTC): the balance above the minimum is charged.

The customer's only receipt is Square's hosted receipt link in the billing page's charge history. **No billing email of any kind is sent**: no receipt, invoice, failed-payment notice, card-expiry notice or cancellation confirmation.

### 7.4 Cancellation and refund as built

- `POST /api/billing/cancel` exists, is tested, and requires the body `{"confirm":"CANCEL"}` so a mis-wired request cannot end a paying relationship. Only a company admin can call it. **No button calls it.** The v2 billing design deliberately left the button out until the page had been tested. Today a customer cannot cancel without contacting the vendor, and the vendor's own super-admin tools cannot cancel, refund, waive, reprice or reactivate: all of that is manual SQL against production.
- Existing cooling-off: a **full refund of the minimum charge (gross, including VAT)** if all five guards pass: the open period collected a prepayment, it is the company's first period, the company has not had a cooling-off refund before, the card fingerprint has not had one under any company, and the period is **48 hours old or less, measured from first vehicle activation**. The refund is issued through Square's Refunds API with a fixed idempotency key per period, so at most one refund per period is possible by construction. A failed refund leaves the company uncancelled rather than cancelled and unrefunded.
- Otherwise, cancellation shortens the period to end tomorrow, invoices the days used, marks the company cancelled before collecting so nothing rolls over, and charges the balance. The balance is floored at zero: a small fleet cancelling mid-period gets no final bill and no money back.
- After cancellation: login and read access continue; licences stay active; a database trigger refuses any **new** vehicle assignment for a cancelled company (existing work is grandfathered); adding vehicles is refused with "contact support"; saving a new card does not reactivate. There is no reactivation path.
- There is no `canceled_at` timestamp on the billing row; the only record of when is the closed period.
- The period-billing design document states: "B2B means no statutory right of withdrawal applies, so this is goodwill rather than compliance." That comment and the 48-hour rationale would need rewriting if a 14-day contractual right is adopted, so the code comments do not contradict the published Terms.

### 7.5 Non-payment

Failed charges retry on days 1, 3, 5 and 7. After four failures the company is marked past due, dunning stops so debt does not stack on a dead card, no new period opens, and vehicles cannot be added. Saving a new card collects everything outstanding and restores the account. **Service-level suspension is designed but not built**: a past-due company keeps full use of the platform. The design (usable in the Terms) is: a single decline does not suspend; only ladder exhaustion does; suspended time is not billed; suspension blocks new operational work but leaves read access and export open, because operator-licence holders have statutory retention duties (tachograph and working-time records 12 months, maintenance 15 months).

---

## 8. Retention, deletion and data-subject rights: current state

**What exists:** one-day opportunistic deletion of rate-limit rows; share-link expiry and revocation (which stop access but delete nothing); single-record deletes by users (a POD photo, a job, a driver, a customer); rollback deletion of a just-created auth user when an invite fails.

**What is deliberately blocked, and must be reflected in the retention schedule and the Terms:**
- A company row cannot be deleted once billing evidence exists (foreign keys were changed from cascade to restrict specifically so a company delete could not wipe VAT and payment records).
- A vehicle cannot be deleted once billing evidence exists.
- The super-admin audit table is append-only.
- Website leads cannot be deleted through the API by any role.
- Quotation acceptances are insert-only.
- A delivery stop with proof of delivery, evidence or scans cannot be deleted or have its address changed.
- Imported tachograph activity is read-only.

**What is missing entirely:**
- No account deletion, no erasure endpoint, no data export or portability endpoint, no retention cron, no anonymisation anywhere.
- No retention limit on the driver GPS trail, drivers' hours records, scan events, POD photographs and documents, delivery and sync logs (the Xero sync log stores full request bodies including customer names and emails), public quote requests and their raw bodies, the Cambridge Audio raw payloads, or leads.
- Removing a user from a company leaves their name, phone, email and auth record intact.
- The designed but unbuilt policy (period-billing design document): a cancelled operator keeps read access for 90 days, then export on request for the balance of 15 months, then deletion. Nothing implements it. The production-readiness review already records "no GDPR erasure, data export or backup and restore runbook".

The Terms and the DPA will need to describe what the vendor will do on cancellation and on a controller's instruction to delete, and section 12 lists the engineering needed to make those promises true. Where deletion is refused (billing evidence, audit trail, contract-formation evidence) the documents should state the legal basis for retention (legal obligation, establishment or defence of legal claims).

---

## 9. Accessibility: current state

The landing page hero states "Built for UK and EU operators · WCAG 2.1 AA · Your data stays yours". A follow-ups document in the repository already flags this as an unbacked claim. The evidence:

- The design system's own contrast test records four shipped contrast failures as floors that must not regress: two body-text tokens in light mode at 4.15:1 and 2.62:1 against a 4.5:1 target, a UI boundary at 1.84:1 against 3:1, and one dark-mode token at 3.10:1. The 4.15:1 token is the one used for the signup page's legal small print and the landing footer, both of which render in light mode.
- No skip-to-content link anywhere.
- The modal component documents that it has no focus trap and no focus restoration.
- The `<html>` element declares `lang="en"` while all content and formatting is British English.
- Login and signup pages have no `<main>` landmark.
- The mobile navigation's `aria-controls` points at an element that does not exist while the menu is closed, and there is no Escape handler.
- A single reduced-motion rule covers one animation only.
- On the positive side: a global focus-visible outline asserted at 3:1 in both themes; proper label association and error wiring in form fields; keyboard-operable table rows and a native select for tenant switching; alt text on all five images; 157 ARIA attributes in use.

Recommendation: either remove the "WCAG 2.1 AA" claim from the hero or replace it with a truthful accessibility statement that says "partially conforms", lists the known gaps above, names a contact for accessibility problems and commits to a review cadence. An unqualified conformance claim in marketing copy is a misrepresentation exposure even for a B2B product.

---

## 10. Security measures relevant to the DPA annex

For the "technical and organisational measures" annex, the following are implemented in code and can be described truthfully:
- Row Level Security in Postgres is the tenant isolation boundary; helper functions fail closed; service-role routes authorise explicitly against the same rules.
- Passwordless magic-link authentication; links opened by email scanners are not consumed; rate limits on login, signup and lead forms are durable across serverless instances.
- An edge gate turns away anonymous requests as defence in depth.
- Proof-of-delivery files live in a private bucket, tenant-scoped by path, served by short-lived signed URLs (60 minutes on share pages); share links are random tokens stored hashed, expiring and revocable, re-checked on every view.
- Card data never touches the vendor's servers (Square iframe tokenisation with 3-D Secure); refunds use fixed idempotency keys.
- Xero OAuth tokens encrypted at rest (AES-256-GCM); Xero OAuth cookies HttpOnly and Secure.
- Security response headers: frame blocking, nosniff, referrer policy, permissions policy.
- Super-admin actions audited by field name only, never by value.
- Driver phone uploads are downscaled client-side, which strips EXIF GPS from photos; office uploads are not, so office-uploaded photos may retain location metadata.

Known gaps to keep out of the annex or to schedule: no formal backup and restore runbook; several production migrations are recorded as unapplied (the production-readiness review lists them); the legacy `job-files` bucket's contents are unknown; environment files in the working tree contain live third-party credentials, including for the unused EmailJS service.

---

## 11. The 14-day right to cancel: legal position and implementation design

**Legal position** (2.1): not statutory for this B2B product. Offering it is a commercial choice. If it is offered, the Terms should define it precisely, because the code will enforce exactly what is defined.

**Decisions the drafting must make, because each changes the code:**

| Decision | Options | What the code does today |
|---|---|---|
| When does the 14 days start? | (a) contract formation at signup; (b) first payment (first vehicle activation); (c) card save | 48 hours from first payment. Signup time exists (`companies.created_at`) but is not wired into the cancellation logic. On option (a) a customer who signs up and activates a vehicle on day 13 has one day of cover; on option (b) every customer gets a full 14 days after paying |
| What is refunded? | (a) the £129.00 minimum in full; (b) everything paid in the window; (c) pro-rata for unused days | Full gross minimum only. There is no partial or pro-rata refund primitive; the balance is floored at zero |
| Does usage reduce the refund? | Yes (consumer-style proportionate charge for days used) or no | Not modelled |
| Does it apply to legacy v1 companies? | Yes or no | v1 has no refund path at all |
| Once per company, once per card, or both? | | Both guards exist and should be kept as anti-abuse measures |
| Must the customer request it in writing, or is the button enough? | | Button does not exist; the API requires an explicit confirmation body |

**Proposed implementation once the decisions are made** (engineering; not started):
1. Replace the `COOLING_OFF_HOURS = 48` constant with a cooling-off window in days and add an anchor input to the cancellation decision function, fed from `companies.created_at` or the period open time depending on the decision. Keep the five guards.
2. Add `canceled_at`, `cancellation_reason` and `terms_version_accepted` columns to `company_billing` (or a dedicated `terms_acceptances` table) so the Terms accepted at signup and the cancellation moment are both evidenced.
3. Add a required acceptance checkbox to the signup form, thread `accepted_terms_version` through the signup validation, the route and the `create_company_with_admin` RPC, and update the Playwright happy-path spec that pins the current links.
4. Add a "Cancel subscription" control to the billing page that posts the confirmation body, shows the applicable outcome (cooling-off refund, days-used settlement, or prepaid-runs-to-end for v1) before the customer confirms, and displays the result.
5. If a pro-rata or partial refund is chosen, add a refund primitive that refunds an explicit amount no greater than the recorded gross charge, with its own idempotency key scheme, and record it as a distinct charge row kind. The vendored Square SDK already exposes partial refunds.
6. Send a cancellation confirmation email (and a refund confirmation) through the existing document delivery path or Resend; there are no billing emails today.
7. Give super-admins a refund and reactivation tool, or document that these remain manual SQL for now.
8. Update the period-billing design document and the code comments that currently say the refund is goodwill because no statutory right applies.

---

## 12. Engineering work the documents depend on

Ordered by what blocks publication.

**Blocking publication of any policy page**
1. Vendor identity content (14.1) and both hosting regions (14.2).
2. Build the public pages. Each new page needs its exact path added to the public-route allowlist, the route-classification test, the themeable-routes list and its test, and (so a signed-in visitor does not get the console sidebar around a legal page) the shell-exemption list and its test. The landing page's pinned-light layout with its nav and footer is the pattern to copy. The landing footer component already carries a comment saying the Privacy and Terms links are hidden until the pages exist; restore them and add the identity block there. Use the stronger text token for small print (the current one is a recorded contrast failure in light mode).
3. Fix the hero copy: remove or qualify "WCAG 2.1 AA".

**Blocking the Terms being true**
4. Recorded terms acceptance at signup (section 11, step 3).
5. Cancel subscription control on the billing page (section 11, step 4).
6. Cancellation and receipt emails.
7. VAT: record the vendor's VAT number and show it on a generated invoice or the Square receipt descriptor; or stop charging VAT if not registered (14.3).

**Blocking the Privacy Notice and DPA being true**
8. Decide and implement retention periods, at minimum for the GPS trail, drivers' hours records, POD files, delivery and sync logs, leads, quote-request raw bodies and the Cambridge Audio raw payloads. A scheduled purge is the natural home (the daily cron already exists).
9. Erasure and export: a per-company export on cancellation and a data-subject erasure path that anonymises rather than deletes where billing, audit or contract evidence must be kept. Removing a user from a company should clear their name and phone.
10. Resolve the quotation view flag and enumerate Square's storage (6.3).
11. Remove the EmailJS dependency and revoke its keys; document the undocumented environment variables (Microsoft Graph, Xero, TomTom, Cambridge, Stripe) in the README and the example env file; correct the README integrations section (Graph, Xero, postcodes.io, TomTom live).
12. Dump the live schema and inspect the `job-files` bucket and the stub compliance tables so the inventory is complete.
13. Configure custom SMTP so auth emails do not go through Supabase's shared relay (already recorded as a launch blocker).
14. Office POD uploads: strip EXIF like the driver path does, or disclose it.

---

## 13. What each document needs

**Terms and Conditions.** Parties and identity block; B2B-only statement and that the customer warrants it acts in the course of business; account and admin responsibilities; the pricing model exactly as in 7.2, including the whole-fleet discount shape and the threshold-parity effect (19 and 20 vehicles cost the same, which the product already discloses); when charges are taken (7.3); VAT; the cooling-off period as decided in section 11; cancellation mechanics and what happens after (7.4); non-payment and the suspension policy (7.5, noting suspension is not yet enforced); the licence gate (an unlicensed vehicle cannot be put to work); the operator's statutory retention duties and the vendor's read-access and export commitments; acceptable use; intellectual property in the platform and in customer data; limitation of liability; that planning's drivers'-hours checks cover EU driving limits and the 45-minute break only (the product says so and the Terms must not imply more); third-party services the customer connects (Xero, Stripe, tachograph provider) and their own terms; changes to terms with a versioning mechanism (the quotation-terms versioning already built for customers' own quotes is a precedent).

**Privacy Notice** (vendor as controller). Identity and contact; the data in 4.1; purposes and lawful bases (contract for accounts and billing; legal obligation for VAT and payment records; legitimate interests for security logs, leads and fraud prevention); recipients (section 5); international transfers with named countries and mechanisms; retention (section 8, once decided); rights, including the DUAA "reasonable and proportionate search" limit on access requests; complaints route including the ICO; device access (geolocation, camera) and the cookie section (section 6); server logs; that auth emails are currently sent through Supabase.

**Cookie Notice.** Sections 6.1 and 6.2 as tables, the statement that no non-essential cookies are used, the Square third-party disclosure, the TomTom tile disclosure, and a "how to object" line for any first-party analytics adopted later under the DUAA exemption.

**Cancellation and Refund Policy.** A plain-language version of 7.4 and the decisions in section 11, with the exact anchor, window, amount and method, the once-per-company and once-per-card limits, the v1 position, and how to cancel (the button once built; a contact address until then).

**Data Processing Agreement** (vendor as processor). Subject matter, duration, nature and purpose; the data categories and data subjects in 4.2 and 4.3, including the special category and criminal-offence data and who holds the Schedule 1 conditions; documented instructions; confidentiality; security measures (section 10); sub-processor list (section 5) with a notification-and-objection mechanism; assistance with data-subject requests and DPIAs (the controller's employment-monitoring DPIA is theirs, but the vendor's GPS and hours data should be described so they can do it); breach notification; deletion or return at end of contract, reconciled with the anti-deletion rules in section 8; audit rights; international transfers; the Cambridge Audio chain (4.4); no automated decision-making.

**Accessibility Statement.** Partial conformance with the listed gaps (section 9), a contact route, the date of the last review, and a commitment to WCAG 2.2 AA over time.

**Service Level Agreement** (optional). Uptime target if any, planned maintenance, support hours and channel, incident communication. If none is promised, the Terms should say so plainly. The daily billing cron and the third-party dependencies (Supabase, Vercel, Square) are the realistic constraints on any figure.

---

## 14. Open questions

For the vendor's owners (Ethan or Stuart):
1. **What is the vendor's legal entity?** Registered name, company number, registered office, whether it is the same entity as ADR Carriers, VAT registration number, ICO registration reference, a contact and a data-protection contact email.
2. **Supabase project region and Vercel deployment region.** Read from both dashboards.
3. **Is the vendor VAT registered?** The code charges 20% unconditionally.
4. Which tachograph data provider, if any, is live in production.
5. Whether anything posts to customer-configured webhook URLs (the field exists; no sender was found).
6. Whether the legacy `job-files` bucket and the stub compliance tables hold production data.
7. Whether any proof-of-delivery signature files exist from before the upload restriction.

For the legal adviser:
8. Confirmation of the B2B position in 2.1 and whether a contractual cooling-off period is wanted at all, and if so the answers to the table in section 11.
9. Which of the disclosure regulations in 2.5 apply to the vendor's entity type.
10. Retention periods for the categories in section 8, particularly the GPS trail and drivers' hours records where the controller's statutory duties (12 and 15 months) interact with proportionality.
11. Whether the quotation acceptance evidence (IP and user agent, immutable) needs a defined retention period tied to limitation periods.
12. Whether the Cambridge Audio consumer data needs a separate processing addendum with that customer.
13. Whether the "WCAG 2.1 AA" hero claim should be removed immediately, ahead of the statement.

---

## 15. Sources consulted

- Consumer Contracts Regulations 2013: applies to trader-to-consumer contracts only. [Which? summary](https://www.which.co.uk/consumer-rights/regulation/consumer-contracts-regulations-ajWHC8m21cAk); [Geldards on business customers having no cancellation right](https://www.geldards.com/insights/does-your-company-need-to-include-a-cancellation-period-in-its-terms-and-conditions/); [legislation.gov.uk text](https://www.legislation.gov.uk/uksi/2013/3134); [Business Companion on distance sales](https://www.businesscompanion.info/en/quick-guides/distance-sales/consumer-contracts-distance-sales).
- DMCC Act 2024 subscription regime delayed to spring 2027: [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts); [Hogan Lovells](https://www.hoganlovells.com/en/publications/uk-subscription-law-shakeup-new-rules-pushed-to-autumn-2026).
- UK GDPR and DPA 2018 relationship: [ICO, Data Protection Act 2018](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-protection-act-2018/); [Practical Law overview](https://uk.practicallaw.thomsonreuters.com/w-014-5998); [legislation.gov.uk DPA 2018](https://www.legislation.gov.uk/ukpga/2018/12/introduction).
- Data (Use and Access) Act 2025 commencement and changes: [RPC](https://www.rpclegal.com/snapshots/data-protection/spring-2026/the-data-use-and-access-act-2025-commencement-update/); [DLA Piper](https://privacymatters.dlapiper.com/2026/02/uk-commencement-of-the-data-protection-provisions-in-the-data-use-and-access-act/); [Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/key-aspects-of-the-data--use-and-access--act-take-effect.html); [Bird & Bird](https://www.twobirds.com/en/insights/2026/uk/uk-gdpr-uk-privacy-reform-is-finally-going-live--what-does-your-business-need-to-do-now); [explanatory notes](https://www.legislation.gov.uk/ukpga/2025/18/notes/division/15/index.htm).
- PECR cookies, strictly necessary exemption and the DUAA analytics exemption: [Lewis Silkin](https://www.lewissilkin.com/en/insights/2025/11/11/ico-sets-the-record-straight-on-storage-and-access-technologies-102ltyf); [Clifford Chance on the ICO consultation](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2025/09/uk-ico-s-updated-guidance-for-new-exceptions-to-cookie-consents-.html); [LexisNexis summary](https://www.lexisnexis.com/en-gb/legal/guidance/cookie-compliance-summary); [Policy Pros on fines](https://www.policypros.co.uk/cookie-consent-changes-duaa-guide/).
- Processor contracts, Article 28(3): [ICO, what needs to be included in the contract](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/); [ICO, when is a contract needed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/when-is-a-contract-needed-and-why-is-it-important/); [ICO, what it means to be a processor](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/what-does-it-mean-if-you-are-a-processor/).
- International transfers and the UK-US data bridge: [ICO, UK extension to the EU-US DPF](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/adequacy-regulations/how-does-the-uk-extension-to-the-eu-us-data-privacy-framework-work/); [ICO adequacy regulations](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/adequacy-regulations/); [Kennedys on the 2026 guidance](https://www.kennedyslaw.com/en/thought-leadership/article/2026/the-ico-s-2026-updated-international-transfer-guidance-decoding-the-new-uk-regime/); [Evalian](https://evalian.co.uk/new-ico-international-data-transfers-guidance/).
- Privacy notice content, Article 13: [ICO, right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/); [ICO, when to provide privacy information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/when-should-we-provide-privacy-information/); [Lexology on an enforcement decision](https://www.lexology.com/library/detail.aspx?g=1bae4ac7-0eee-4b3b-a8c0-5c53b03124cc).
- Accessibility, private sector: [AudioEye on the Equality Act and PSBAR](https://www.audioeye.com/post/uk-website-accessibility-law/); [Level Access](https://www.levelaccess.com/blog/website-accessibility-laws-in-the-u-k/); [DBS Digital](https://www.dbs.digital/hints-and-tips/is-there-a-legal-requirement-in-the-uk-for-websites-to-be-accessible/).
- Square Refunds API (partial refunds supported; idempotency key; "payment too old" error): [Square developer reference](https://developer.squareup.com/reference/square/refunds-api/refund-payment).

---

## Appendix A: engineering references

File paths for the engineer, grouped by topic. Line numbers are as of `8ce53ae`.

**Legal-page plumbing:** `lib/auth/publicRoutes.ts` (exact-path set, no prefixes by rule), `lib/auth/routeClassification.test.ts` (walks `app/` and fails on unlisted routes), `lib/nav/themeableRoutes.ts` and `.test.ts` (verbatim list), `lib/nav/shouldShowShell.ts` and `.test.ts`, `components/landing/Footer.tsx:12-14` (hidden links comment), `app/page.tsx:57` (pinned-light root pattern), `app/signup/page.tsx:181-191` (acceptance sentence), `tests/signup-happy-path.spec.mjs:98` (pins the two links), `components/landing/Hero.tsx:91` (WCAG claim).

**Signup and acceptance:** `lib/validation/signup.ts`, `lib/auth/signup.ts:140-225`, `app/api/signup/route.ts`, `docs/sql/signup_01_create_company_with_admin.sql`.

**Billing and cancellation:** `lib/billing/cancellation.ts` (`COOLING_OFF_HOURS` at line 10; guards at 113-119; v1 at 149-172), `lib/billing/periodServer.ts:1555-1844` (`cancelCompany`, `markCancelled`), `lib/billing/periodPaymentServer.ts:411-513` (`refundPeriodMinimum`, the only refund call), `lib/billing/periodPayment.ts:150-169` (balance floored at zero), `app/api/billing/cancel/route.ts`, `app/api/billing/card/route.ts`, `app/api/licences/activate/route.ts`, `lib/billing/rateCard.ts`, `lib/billing/money.ts`, `lib/billing/vat.ts:13-21`, `lib/billing/pricingCopy.ts`, `app/settings/billing/V2Billing.tsx`, `docs/sql/billing_06_period_billing.sql` (`cooling_off_refunded_at` at 149-150), `docs/sql/prodfix_33_billing_integrity.sql` (card fingerprint, refund_pending), `docs/sql/prodfix_30_vehicle_licence_gate.sql:175-188` (LIC02 on cancelled companies), `docs/sql/prodfix_31_billing_evidence_retention.sql` (delete restrictions), `docs/superpowers/specs/2026-09-10-period-billing-design.md:174-192, 234-247` (suspension and retention designs; goodwill comment).

**Personal data hot spots:** `app/drivers/page.tsx:22-175` (driver record shape), `app/api/driver/location/route.ts:55-63` and `app/driver/DriverGpsTracker.tsx:222` (GPS), `docs/sql/prodfix_50_quotation_share_acceptance.sql:351-395` (IP and user agent), `app/api/integrations/cambridge-audio/rma/route.ts:18-59, 140-177, 285-339` (consumer data), `docs/sql/prodfix_20_user_management.sql:327-354` (user removal leaves PII), `docs/sql/registration_requests_rls.sql:92-95` (no delete), `docs/sql/prodfix_01_rate_limits.sql:56-59` (only time-based deletion), `lib/pod/evidencePath.ts`, `lib/pod/podUrl.ts`, `docs/sql/prodfix_82_storage_buckets_private.sql`, `app/driver/jobs/[jobId]/downscaleImage.ts` (EXIF strip on the driver path only), `docs/sql/schema_rls_dump.sql` (read-only live schema dump).

**Sub-processors:** `lib/documents/delivery.ts:92, 166, 205-226` (Microsoft Graph), `app/api/request-access/route.ts:158-256` (Teams and Resend), `components/billing/SquareCardForm.tsx:38-40, 72-119, 152-160` (Square SDK), `lib/payments/square.ts`, `app/api/settings/payments/stripe/connect/route.ts`, `lib/tomtom/api.ts`, `app/api/tomtom/geocode/route.ts:36-38, 407-532` (postcodes.io and log lines), `app/tracking/TrackingMap.tsx`, `app/planning/PlanningMap.tsx`, `app/telematics/TelematicsFleetMap.tsx`, `lib/accounts/providers/xero.ts`, `app/api/accounts/accounting/xero/invoices/[id]/sync/route.ts:105-190, 541-613`, `lib/tachograph/provider.ts:12-40`, `app/pod/page.tsx:836-848` (WhatsApp), `app/driver/jobs/[jobId]/page.tsx:380` (Google Maps), `package.json` (`@emailjs/browser` unused).

**Cookies and storage:** `proxy.ts:81-113`, `lib/supabase/browser.tsx:13`, `app/api/accounts/accounting/xero/connect/route.ts:39-61`, `lib/theme/theme.ts:8`, `lib/tenant/context.ts:106-108`, `lib/quotations/draftStorage.ts:11-26`, `lib/planning/draftCache.ts:4-5, 98`, `app/quotation/share/[token]/AcceptanceClient.tsx:92-124`, `node_modules/@tomtom-international/web-sdk-maps/dist/maps-web.min.js` (dormant mapbox telemetry path, gated on an access token the app never sets).

**Accessibility:** `lib/theme/contrast.test.ts:214-219` (known gaps), `components/Modal.tsx:13-28`, `app/layout.tsx:64`, `components/landing/LandingNav.tsx`, `app/globals.css:76-80`, `docs/landing-redesign-followups.md:75-80, 118-131, 221-222`.
