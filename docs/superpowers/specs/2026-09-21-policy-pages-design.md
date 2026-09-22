# Policy pages design

Date: 2026-09-21
Branch: `ethan/policy-pages` (cut from `feat/self-serve-signup` at `8ce53ae`, because the `/terms` and `/privacy` links live on the signup page there).
Source: the fifteen PDFs in `docs/TMS POLICIES/` and `docs/handoffs/2026-09-17-uk-legal-policies-handoff.md` (section 12 item 2, section 13).

Ethan asked for this while away from the keyboard, so the usual approval step was replaced by this document. Every judgement call is listed under "Assumptions" so it can be reversed.

## 1. Document check

The handoff (section 13) requires seven documents: Terms and Conditions, Privacy Notice, Cookie Notice, Cancellation and Refund Policy, Data Processing Agreement, Accessibility Statement and an optional Service Level Agreement. All seven are in the folder, plus eight more.

| No. | Document | Audience (per 00 checklist) | Published as |
|---|---|---|---|
| 00 | Publication Checklist | Internal note, "should not be published" | not published |
| 01 | Terms and Conditions | Public | `/terms` |
| 02 | Privacy Notice | Public | `/privacy` |
| 03 | Cookie Notice | Public | `/cookies` |
| 04 | Cancellation and Refund Policy | Public, part of the Terms | `/cancellation-policy` |
| 05 | Data Processing Agreement | Public, part of the Terms | `/dpa` |
| 06 | Accessibility Statement | Public | `/accessibility` |
| 07 | Service Level and Support Policy | Public, part of the Terms | `/support-policy` |
| 08 | Acceptable Use Policy | Public, part of the Terms | `/acceptable-use` |
| 09 | Sub-processor List | Public, part of the DPA | `/sub-processors` |
| 10 | Security Overview | Public or on request | `/security` |
| 11 | GDPR and Data Protection Policy | Internal | not published |
| 12 | Data Subject Access Request Procedure | Internal | not published |
| 13 | Data Retention Schedule | Internal, available on request | not published |
| 14 | Data Breach Response Procedure | Internal | not published |

Nothing required is missing. Document 10 is published because DPA Annex 2 incorporates it by reference, so a customer accepting the DPA must be able to read it. Document 13 stays unpublished because the Privacy Notice says it is "available on request".

## 2. Approaches considered

1. **Hand-written TSX per page.** Simple, but 11,000 words of legal text retyped by hand invites transcription errors, and every revision from the solicitor means editing JSX.
2. **One dynamic `/legal/[slug]` route.** Fewest files, but the public allowlist forbids prefixes and patterns wider than a token, `/terms` and `/privacy` are already linked and pinned by a Playwright spec, and short root paths are what people type.
3. **Chosen: structured content generated from the PDFs, one shared renderer, one static route per document.** A converter reads each PDF with font and position data and writes verbatim JSON (headings, paragraphs with bold runs, lists, tables). One server component renders any document. Each route is a five-line `page.tsx`, so the public allowlist stays exact-path.

## 3. Design

**Content.** `scripts/legal/convert-policies.py` (PyMuPDF, run by hand) writes `lib/legal/content/<slug>.json` for the ten public documents only. A small patch table in the script repairs the few places where a narrow PDF table column split a word. The text is otherwise verbatim: no rewording, including the product spelling "TMSWizzard".

**Registry.** `lib/legal/documents.ts` maps each path to its title, one-line summary and content. `lib/legal/routes.ts` holds just the path list, with no content import, so `shouldShowShell` can use it without pulling legal text into the client shell bundle.

**Vendor identity.** `lib/legal/vendor.ts` holds the company number, substituted for `[COMPANY NUMBER]` at render time. The PDFs also carry `[VAT NUMBER]`, `[ICO REFERENCE]`, `[CONFIRM MECHANISM]` and `[CONFIRM TENANT REGION]`. Ethan confirmed on 2026-09-22 that the vendor's facts are those of the ADR Carriers originals, which give the company number (14798586) but no VAT number or ICO reference, and asked for the unfilled pieces to be trimmed. The converter's `TRIMS` table removes exactly those sentences and notes, with match counts, so the cut is reproducible and stops matching when the PDFs are reissued.

**Draft guard.** While any square-bracket placeholder survives substitution, that page shows a "Draft, not yet in force" notice and is served `noindex`. The guard is computed, not a flag, so it lifts by itself when the facts are filled in and cannot be forgotten in either direction. After the trims, no placeholder survives and no page is in draft.

**Rendering.** `components/legal/LegalPage.tsx` is a server component: pinned-light root (`ds light ... bg-canvas font-sans text-ink`) as on the landing page, a slim header, a skip link, a `<main>` landmark, the company block, numbered sections with anchor ids, responsive tables with a caption-free `<th scope="col">` header row, and the landing footer. Names of other published documents and email addresses in the text become links (pure function, unit tested). Small print uses `text-ink-2`, not `text-ink-3`, which is a recorded contrast failure in light mode.

**Index and footer.** `/legal` lists the ten documents. The landing footer regains Terms, Privacy, Cookies and an "All policies" link, plus the vendor identity line. Its Contact anchor becomes `/#request-access` so it works away from the landing page.

**Plumbing.** Each of the eleven paths is added to `publicRoutes.ts` (explicitly, one line each), the route classification test, `themeableRoutes.ts` and its test, and the shell exemption and its test. `lib/legal/routes.test.ts` cross-checks that every legal path is public, themeable and shell-free, so a twelfth page cannot be half wired.

**Tests.** Registry and content shape; placeholder substitution and the draft guard; linkify; the route cross-check; and a drift guard asserting the Terms' prices (unit price, minimum, the four discount steps, and "19 and 20 vehicles cost the same") against `lib/billing/rateCard.ts`.

## 4. Out of scope

Everything else in handoff section 12: recorded terms acceptance at signup, the cancel button, billing emails, VAT on receipts, retention purges, export and erasure. The one exception is the hero "WCAG 2.1 AA" claim, which directly contradicts the Accessibility Statement being published here, so it is replaced with a link to that statement.

## 5. Assumptions to confirm

1. Documents 01 to 10 are public; 00 and 11 to 14 are not.
2. The paths in the table above.
3. Pages ship with the draft notice and `noindex` until the placeholders are resolved, instead of being held back entirely. The signup page links to `/terms` and `/privacy` today and both bounce to login, which is worse than a marked draft.
4. The documents say "TMSWizzard" and the product says "TMS Wizzard". The legal text is kept verbatim; page chrome uses the product spelling.
5. Only the ten public PDFs are committed, because the converter needs them to regenerate the content. The five internal ones (00 and 11 to 14) are left untracked: the repository's visibility could not be checked from the session, and the checklist says document 00 should not be published. Ethan decides whether they belong in git.
6. The checklist asks for a solicitor review before publication. Nothing here replaces that.
