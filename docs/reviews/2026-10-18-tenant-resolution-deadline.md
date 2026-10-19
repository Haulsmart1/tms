# Account lookup recovery deadline

The root TenantProvider awaited both `auth.getUser()` and `get_tenant_context`
without a deadline. A request that never settles leaves the initial gate on
Loading indefinitely, even though the gate already has a retry view for rejected
requests. Each lookup now has a 15-second UI deadline, entering the existing
failure path. Two serial lookups can therefore take up to approximately 30
seconds before recovery; browser timer suspension can extend wall-clock time.

Blocking failure stays closed and offers Try again. Background failure retains
the last usable context. Actual missing-session responses still use the existing
signed-out behavior. Existing sequence checks guard superseded resolves. No
cookie, localStorage, IndexedDB, driver queue or evidence is cleared.

This bounds the application's wait, not SDK network execution or the Auth lock.
Late requests can still finish within the SDK, including session-cookie work.
A retry cannot force an internally stuck SDK lock to unlock. No recovery of
historical evidence or proof of Danielle's incident cause is claimed.

Read-only checks on 18 October confirmed the existing Danielle account is
email-confirmed, unbanned, profile-linked to a tenant and role, with one legacy
membership. The last recorded sign-in was 15 October. Aggregate Auth logs on
18 October include successful user/token requests and one `otp_disabled` error;
the latter cannot be attributed to Danielle from aggregate records. No real
login email or account change was performed.

Verification: all 285 Vitest files and 3,288 tests pass; `npm run typecheck`
passes. Five new deadline tests cover a hanging request, normal success, rejection, lazy
PostgREST thenables and late completion after a retry. These are deterministic
local async tests, not hosted session or phone acceptance. Release remains
blocked pending controlled hosted/device acceptance and explicit deployment
approval. Built on the existing complete PR37 candidate; GPS proposals remain
excluded. No live configuration, schema, billing, email or deployment changes.
