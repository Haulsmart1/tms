/* Moved verbatim out of page.tsx so the card can share it without importing
   the page, which imports the card. */
export type TenantUser = {
  membership_id: string;
  user_id: string | null;
  tenant_id: string;
  role: string;
  membership_created_at: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  company_id: string | null;
  role_id: string | null;
};
