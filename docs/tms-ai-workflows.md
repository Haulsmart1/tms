# TMS AI workflows

## First implementation — 7 November 2026

The existing **TMS Assistant** and **Review this record with Assistant** now offer an explicit Ask AI action, quick reviews, missing-detail checks, and copyable customer-update drafts. Opening a panel only loads facts; it does not call a model.

- Job reviews include reference, saved status/progress, date, assignment presence, ETAs, towns/postcodes and contact completeness. Names, phone/email values, street addresses, attachments and free-text job notes are not transmitted automatically.
- Planning reviews use a date chosen in the Assistant and saved database assignments. Unapplied saved plans and browser-only changes are excluded. Active assigned/unassigned, missing-driver, collected and delivered counts are calculated by code before sending them to AI. Reads over 500 jobs report the total and a limit warning instead of incomplete detailed counts.
- Customer/invoice reviews use the existing minimal record facts. They do not inspect full histories, amounts, banking data or external accounting systems.
- Compliance guidance explains recorded source warnings; it has no live regulatory search and does not approve dispatch.

## Configuration and operations

Use Node 22 or later (TMS deploys on Node 24), installed `ai` SDK 7, and `TMS_AI_ENABLED=true` plus `TMS_AI_MODEL=anthropic/claude-haiku-5.5`. This model was present in the full Gateway catalogue on 7 November 2026 and supports structured output. The model remains server-configurable.

On Vercel, the SDK authenticates with the project's automatic OIDC token. No Debbie key is copied. For local development, link the TMS project and pull short-lived OIDC or use a separate server-only AI_GATEWAY_API_KEY. Never put keys in NEXT_PUBLIC variables.

The authenticated POST `/api/assistant` enforces the existing office role and tenant capabilities. All record reads retain RLS and explicit tenant predicates. The browser supplies only a permitted area, optional record/date and a bounded question; arbitrary context, models and tools are rejected. Responses are plain text, schema-validated, and never executed. No emails or job changes are performed by the Assistant.

The existing durable `rate_limit_hit` RPC is required. AI calls fail closed if it is absent/unavailable. Limits: 20 requests/user/hour, 100/tenant/day and 300/project/day. Each attempt reserves capacity, including failed or cancelled generations. Each model call has a 30-second timeout, a 2,500-output-token cap and no SDK retries. These are request/token limits, not a guaranteed currency budget; model prices/configuration can change. Gateway account credit/budget policies still apply.

Disable AI with `TMS_AI_ENABLED=false` and redeploy; local facts continue working. Logs record model, area and token usage only, never questions or customer facts. Gateway Logs provide provider usage and cost. Provider failures show a retryable message and leave all operational records unchanged.

Run `node scripts/verify-ai-gateway.mjs` explicitly in the linked environment for a single synthetic inference plus empty-tenant schema/read and separate limiter-counter checks. It does not contact customers or change jobs. The script is not run on normal builds. Office-session browser acceptance remains a separate check.

## Next opportunities, in useful order

| Workflow | Proposed AI assistance | Needed before enabling writes |
| --- | --- | --- |
| Email/PDF booking intake | Extract references, contacts, addresses, quantities and requested slots into a reviewable job draft | Connect authorised mailbox/document sources; validate required fields and duplicate references |
| Collection reconciliation | Match labels, barcode scans, driver notes and receipts to exact jobs; list ambiguous matches | Evidence provenance, exact identifiers, human approval of completion changes |
| Planning exceptions | Explain missing assignments, impossible slots and missing contact details, with links to affected jobs | Reuse deterministic route/compliance checks and saved-plan state; never let a model approve legality |
| Customer communication | Prepare AM/PM notifications, delay explanations and receipts using verified status | Existing recipient resolution, preview, send permission and idempotency |
| Invoice readiness | Explain missing PO/POD and discrepancies; prepare a billing checklist | Authorised monetary data and accounting rules; human approval before posting |
| Plain-language search | Find a job by reference, postcode or barcode and explain its recorded progress | Tenant-scoped deterministic search tools with bounded results and record links |

No mailbox ingestion, photo matching, automatic allocation, completion, billing or customer-email sending is implemented by this release.
