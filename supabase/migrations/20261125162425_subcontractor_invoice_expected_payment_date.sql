alter table public.subcontractor_portal_invoices
  add column expected_payment_date date,
  add constraint subcontractor_invoice_expected_payment_date_valid
    check (expected_payment_date is null or expected_payment_date >= issue_date);

grant update (expected_payment_date) on public.subcontractor_portal_invoices to service_role;
