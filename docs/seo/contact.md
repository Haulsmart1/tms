# Public contact and homepage consolidation

Official contact details supplied by the user: **support@tmswizard.com** and **0800 999 1263**. Code uses `lib/contact/details.ts` as the shared source for the enquiry recipient, displayed address and telephone links.

## Audit and change

The former homepage RequestAccessForm posted to `/api/request-access`, which requires a Supabase service-role client, durable database rate limiting and optional Teams/Resend notification. Its client treated every `ok` response as success regardless of the returned `notified` value. The form also linked to signup even though signup is closed by default, and public navigation/feature CTAs used an in-page request-access anchor.

The public homepage now has a contact CTA section with telephone and email. All public Contact/Request access links, including the closed-signup notice and existing tenant-gate recovery link, lead to `/contact`. The old homepage anchor is retained only as a useful destination for existing bookmarks; no new links point to it. The obsolete form component is removed. The legacy API remains unchanged for compatibility with earlier callers; no website form calls it. FormSubmit enquiries do not write `registration_requests` or feed the application lead inbox.

`/contact` is static, public, indexable, included in the XML sitemap, and has canonical/social metadata plus ContactPage structured data reflecting the visible details. `/contact/thank-you` is public only for native form returns, remains noindex by both metadata and header, and is excluded from the sitemap. Neither page mounts the tenant/application frame.

## Form behaviour

- Required: name, company/business name, email, enquiry type and message. Optional: telephone and fleet size. Product, access, existing-customer support and other enquiries are selectable.
- HTML constraints work without JavaScript; enhanced validation trims input, limits lengths and validates email, optional phone and whole fleet counts. Errors are associated with fields; the first invalid control receives focus.
- Enhanced requests POST JSON to `https://formsubmit.co/ajax/support@tmswizard.com`. Native fallback POSTs to `https://formsubmit.co/support@tmswizard.com`, with an absolute return URL at `https://tmswizard.cloud/contact/thank-you`.
- `_honey` uses FormSubmit's documented honeypot, hidden from users/tab order. Enhanced code drops filled honeypots before a request. Provider CAPTCHA defaults remain intact for the native flow; `_captcha=false` is not added. AJAX does not load an embedded CAPTCHA widget; spam handling there relies on the honeypot and FormSubmit's provider controls, not a claimed site-owned rate limiter.
- A synchronous in-flight guard prevents duplicate submissions. A 20-second timeout bounds the wait; navigation aborts an outstanding request. Errors preserve form values. Network/invalid JSON failures do not falsely claim that nothing was sent; they say confirmation was unavailable.
- Only an OK response with a recognised provider success value produces the inline success panel, which receives focus. Activation-required responses produce a contact fallback message, not a claim that an email was delivered. No autoresponder or response-time promise is made.
- The published email address is not a secret. No API key, service-role credential, SMTP credential or webhook secret is added to client code.

Provider docs consulted: [FormSubmit documentation](https://formsubmit.co/documentation), [AJAX documentation](https://formsubmit.co/ajax-documentation) and [activation help](https://formsubmit.co/help).

## Consistency and policy presentation

The homepage, dedicated Contact page and shared public footer show the official telephone/email. Marketing and policy pages share the footer. Existing generated policy documents still carry their historical `it@silverlady.group` source text. A narrowly scoped rendering substitution replaces every displayed occurrence and its mailto link with the user-supplied official address; source PDFs/JSON, contractual periods, pricing and other wording are unchanged. Regression tests verify the display conversion across all ten documents, and HTTP checks verify no obsolete email is emitted by any public page.

The Privacy Notice and Sub-processor List include a clearly separated current-website-form notice that names FormSubmit and links its privacy information. The contact form discloses this provider before collection and asks visitors to omit passwords and customer delivery records. Original policy PDFs and their historic provider descriptions should be updated through the document-maintenance process before a separately authorised publication; this branch does not invent FormSubmit hosting locations, transfer safeguards or contractual assurances.

## Activation and release limitation

FormSubmit requires mailbox confirmation/activation for a recipient form. **No real submission or activation email was triggered in this task.** Recipient activation and live email delivery to `support@tmswizard.com` are therefore unverified. An authorised mailbox owner must verify that setup separately before relying on the live form. Published telephone/email links remain usable independently of the form.

Local tests intercept all provider requests before network transmission and fulfil them with fixture responses. They cover validation, activation handling, malformed JSON, provider rate-limit errors, success, duplicate prevention, honeypot suppression and native no-JavaScript attributes. They prove local behaviour, not live delivery or provider CAPTCHA operation. No production credentials, production data, deployment or other worktree was used.
