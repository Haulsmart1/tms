# TMS → Debbie invoice proposals v1

Local contract and mock only. No Debbie repository, database, HTTP service, credential or ledger is accessed.

TMS owns transport jobs, POD evidence and the operator's approved invoice proposal. Debbie independently validates customer/account mapping, taxes, accounting periods, permissions and posting. TMS cannot create journals or mark a proposal posted by itself.

`InvoiceProposal` in `lib/integrations/debbie.ts` supplies tenant/company/job/customer identities, a persistent proposal ID, invoice reference, service date, decimal quantity, integer net minor units, a proposed tax code/rate, currency, supporting opaque job/POD references and approver/time. GBP/EUR/USD are the currently supported two-decimal currencies. Tax is explicitly a proposal. Never convert missing tax/price into an assertion of zero liability.

Persist the proposal ID once. `commercialEventId(tenantId, proposalId)` is the canonical commercial identity; editing a display invoice number does not change it. The sending outbox and receiving Debbie service must enforce both canonical event identity and scoped idempotency. A successful response is bound to the same event and request key. A changed payload under an existing key fails; do not silently create another invoice. Corrections/reversals require separate versioned operations linked to the original identity.

Customer mapping requires tenant + TMS customer ID + Debbie company/customer IDs + an authorised approval record. Similar names are not identity. A production mapping adapter must verify that the mapped Debbie company is the authorised receiving company; a signed connection/install boundary has not yet been implemented.

Results: received, validation-required, approved, posted, rejected, reversed or failed. Posted requires an accounting invoice identity returned by Debbie. Transport completion is distinct from accounting posting. The mock always returns `mode: mock`, `validation-required`, and no posted invoice identity.

`IntegrationOutbox` specifies durable enqueue, atomic lease claim and token/generation/expiry-fenced completion. `SupabaseIntegrationOutbox` delegates those operations to service-only RPCs in `integration-outbox-review.sql`. SQL has not been applied or executed. Tests use independent snapshots/shared in-memory doubles and prove application contracts, not PostgreSQL runtime behavior. No production dispatcher, webhook handler or transfer UI is enabled.

Before activation: independently review/apply/test schema on an isolated database; implement authenticated installs and encrypted vault references; verify receiver authentication, customer mapping, webhook signatures, canonical identity deduplication and immutable actor-attributed audit on both sides; create an explicit invoice-proposal review/approve action. The real adapter must never automatically enable itself through a mock flag.
