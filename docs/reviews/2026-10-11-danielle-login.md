# Danielle login priority investigation

## Finding and recovery

The reported sequence is explained by single-use link redemption plus separate browser sessions. A successful redemption consumes the link. Chrome retains its own session; Safari does not inherit that session. The current callback explicitly recovers a failed replay only when `getUser()` independently confirms a session in the receiving browser. Thus a used invitation can appear to keep working in Chrome and fail in Safari. This is reproduced through the actual callback handlers with isolated Auth fixtures.

This is the leading diagnosis, not a claim of a captured Safari incident. The original failed URL, response/error code, incident timestamp, deployed source version and hosted template/settings were not supplied. Without those, the exact historical error cannot be established. No Safari-specific defect has been demonstrated. Fresh-link PKCE/browser-context failure remains possible for legacy `code` URLs, but current ordinary login uses implicit OTP issuance and token-hash verification, without an originating-browser verifier dependency.

Correct recovery: Danielle opens https://tmswizard.cloud/login in Safari, enters the email of her existing invited account, requests an ordinary login link herself, opens the newest login email in Safari and presses Continue. Do not reuse the original invitation or recreate the account. If Chrome is still signed in, opening the ordinary dashboard there may continue to work independently. If a fresh Safari link fails, capture its error code and time without sharing token/hash contents; a legacy PKCE error calls for the originating browser or a new ordinary login flow. No real link was sent during this investigation.

## Read-only account evidence

Supabase TMS Project: Danielle Miller's profile-linked account was invited 13 August, email-confirmed 14 August and last signed in 7 October 2026 at 10:58:36 UTC. It exists, is not deleted, has no active ban, and has both a profile tenant and role. Audit rows show successful login and session refreshes, including a recovery request followed by login on 7 October. They do not establish the Safari failure. A second name-matching email-local-part account has no profile or recorded login; name matching alone cannot establish that it belongs to Danielle. It was left untouched. Recovery must use the existing invited-account email.

## Complete flow inspected

- `/login` calls `/api/auth/magic-link`; the server uses implicit flow, no persistence and `shouldCreateUser:false`. It does not create users. Existing confirmed users receive ordinary login rather than reusing invitation tokens; settings invite fallback also requests ordinary login.
- Repository templates use `/auth/confirm?token_hash=...&type=email` or `type=invite`. GET does not redeem an OTP. The explicit same-origin form POST to `/api/auth/callback` verifies the original type and copies session cookies onto the final redirect. This protects against scanners consuming links on GET.
- The callback's legacy `code` branch exchanges a PKCE code and depends on the originating browser's verifier cookie. Legacy fragment errors are now surfaced by the login page. Token-hash verification is independent of the browser that requested the link.
- Browser/server clients use `@supabase/ssr` cookies; installed cookie defaults are first-party path `/`, SameSite=Lax. No local/session-storage verifier is required by the current token-hash flow. Cookies remain scoped to browser and site. Cookie blocking, private browsing and host differences can separately lose sessions; no real Safari device test was performed.
- Redirects use configured public origin, same-origin `next` validation and 303 after POST. Templates use `.SiteURL`; their deployed contents and hosted allowlist were not verified. Local config is localhost with local confirm/wildcard redirects and `otp_expiry=3600`. This is not proof of hosted expiry. Supabase documents one-time magic links and a default one-hour expiry for emailed OTP links, including invitations.
- Supabase's `otp_expired` covers invalid/expired tokens and cannot prove which individual token was consumed. No replay protection was relaxed. An independently verified existing session is required for replay recovery.

## Application fix and verification

Added explicit single-use/browser-session recovery copy on login/confirmation, ordinary login recovery for redeemed invitations, classification for OTP versus legacy PKCE failures, and separate infrastructure/session messages. Account-enumeration-safe sending remains intact. Hosted templates/settings, accounts, production data and emails were not changed. No deployment was performed.

Initial targeted verification: five test files, 75 tests passed. New actual-handler tests cover fresh email/invite/magiclink redemption without browser cookies, emitted session cookies, first redemption then same-browser replay then browser-without-session replay, new ordinary login recovery, expired/invalid OTP, four legacy PKCE errors, scanner GET and cross-origin POST rejection. These are mocked Auth integration tests, not real Supabase token issuance or real Safari automation.

Final verification: all 254 test files and 2,906 tests passed. Typecheck and offline build verification passed. Login recovery preserves the validated intended destination. The offline build uses substitute typography and inert public Supabase fixtures; it is a verification artifact, not a release build. Real Safari and hosted Auth settings/template verification remain outstanding.

References: [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [error codes](https://supabase.com/docs/guides/auth/debugging/error-codes). Current changelog was reviewed; no relevant hosted magic-link semantics change was identified.
