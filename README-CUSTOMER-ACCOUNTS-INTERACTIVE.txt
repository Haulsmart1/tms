Customer Accounts interactive upgrade

Adds:
- app/api/accounts/lookups/route.ts
- replacement app/invoices/page.tsx

Interactive controls now include:
- consolidated invoice creation
- payment recording and invoice allocation
- credit note creation
- statement generation
- chase letter creation
- customer PO creation
- supplier/subcontractor PO creation
- accounting provider configuration

This phase does NOT yet send email or generate PDFs.
It also does not yet implement OAuth provider connections.
Those should be the next two phases after this build passes.

Safe install:
1. Back up app/invoices/page.tsx.
2. Extract ZIP into project root.
3. npm run build
4. Preview deploy only
