XERO CONNECTOR PHASE 1

This adds secure Xero OAuth connection plumbing only.

Current Xero requirements checked against Xero Developer docs:
- Standard authorization-code flow is appropriate for web-server apps.
- Authorization endpoint:
  https://login.xero.com/identity/connect/authorize
- Token endpoint:
  https://identity.xero.com/connect/token
- Connections endpoint:
  https://api.xero.com/connections
- Access tokens last about 30 minutes.
- offline_access is required for refresh tokens.
- Granular accounting scopes are now assigned to Web/PKCE apps.

Scopes requested:
openid
profile
email
offline_access
accounting.invoices
accounting.payments
accounting.contacts
accounting.settings
accounting.attachments

1. RUN SQL
supabase/migrations/20260814_xero_oauth_credentials.sql

2. CREATE XERO APP
In Xero Developer, create an OAuth2 Web app using Auth Code grant.

Production redirect URI:
https://tmswizard.cloud/api/accounts/accounting/xero/callback

For Preview testing, add the preview callback too and set the Preview
XERO_REDIRECT_URI environment variable to that exact preview callback.

3. VERCEL ENV VARIABLES

XERO_CLIENT_ID
XERO_CLIENT_SECRET
XERO_REDIRECT_URI
ACCOUNTING_TOKEN_ENCRYPTION_KEY

Generate encryption key in PowerShell:

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)

Store the output as ACCOUNTING_TOKEN_ENCRYPTION_KEY.
Do not commit the value to Git.

4. ROUTES

GET  /api/accounts/accounting/xero/connect?tenantId=...
GET  /api/accounts/accounting/xero/callback
GET  /api/accounts/accounting/xero/status?tenantId=...
POST /api/accounts/accounting/xero/test
POST /api/accounts/accounting/xero/disconnect

5. SECURITY

OAuth tokens are AES-256-GCM encrypted before database storage.
The credential table is service_role only.
Do not expose it to browser Supabase queries.

6. NEXT PHASE

After connection testing succeeds:
- TMS customer -> Xero Contact
- TMS invoice -> Xero Invoice
- TMS credit note -> Xero Credit Note
- TMS payment -> Xero Payment
- POD attachment -> Xero invoice attachment
- accounting_entity_links mappings
- accounting_sync_log audit trail
