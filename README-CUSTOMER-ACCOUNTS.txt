Customer Accounts upgrade

Files:
- app/invoices/page.tsx
- app/api/accounts/*
- lib/accounts/server.ts

This expects the Accounts SQL migration already installed:
invoice_lines, invoice_jobs, customer_payments, payment_allocations,
credit_notes, credit_note_allocations, customer_statements,
customer_chase_letters, purchase-order tables, accounting integrations,
customer_aged_debt view and jobs_ready_to_invoice view.

Safe install:
1. Back up app/invoices/page.tsx.
2. Extract this ZIP into the TMS project root.
3. npm run build
4. Preview deploy before production.

The first UI pass provides a working Ready-to-Invoice flow and invoice listing.
The other tabs are connected to their APIs and display live records; richer
forms/PDF/email/provider OAuth can be layered on next.
