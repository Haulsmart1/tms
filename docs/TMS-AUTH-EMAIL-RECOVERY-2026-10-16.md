# TMS sign-in email delivery recovery

## Verified incident

Read-only Supabase Auth logs for TMS Project (`llxliojjtofqdmddbdud`) on
16 October 2026 showed `/otp` returning HTTP 429 with
`over_email_send_rate_limit` at 14:12, 14:14 and 14:26 UTC. Earlier successful
magic-link sends used `noreply@mail.app.supabase.io`. This confirms provider
rate limiting; a READY Vercel build does not verify email delivery.

The application intentionally responds identically for existing and unknown
addresses. Do not expose raw provider errors or change `shouldCreateUser:
false`: either can disclose account membership or enable unwanted signups.

## Administrator action

1. Open the TMS Project in Supabase, Authentication, Email/SMTP settings.
   Check the current provider configuration; do not use the Debbie Vercel
   project ID as a Supabase reference.
2. Configure an approved production SMTP provider and verified sending domain.
   Enter credentials directly in Supabase, never in chat, Git, screenshots or
   a public environment variable. Confirm that the sender address is approved
   by the provider before using `support@tmswizard.com`.
3. Review Supabase Auth email rate limits and the provider's own sending limits
   together. Retain application IP/email rate limits and invitation-only access.
   Do not disable confirmation or enable public signup to work around delivery.
4. Preserve existing redirect settings and the `/auth/confirm` email template.
   That page requires an explicit Continue action to avoid automated scanners
   consuming the token.
5. Use an authorised existing test account and request one fresh link after
   configuration. Confirm `mail.send` and `/otp` success in Auth logs, inbox
   receipt, explicit confirmation, dashboard session, logout and a second fresh
   login. Do not reuse links or clear driver offline data.

## Acceptance and limits

This patch improves the login explanation and retains the entered address for
checking spelling. It does not change SMTP configuration, send test emails,
modify live records, or claim delivery is restored. SMTP access and an approved
provider are still needed to complete the delivery repair.

Reference, checked 16 October 2026:
https://supabase.com/docs/guides/auth/auth-smtp

Supabase documents that its default email service is for testing, restricts
recipients and is currently limited to two messages per hour. Production use
requires custom SMTP. Recheck current limits before configuration.
