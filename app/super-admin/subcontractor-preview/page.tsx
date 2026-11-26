import Dashboard, { type DashboardResponse } from "../../subcontractor/dashboard/Dashboard";

const preview: DashboardResponse = {
  portalUser: {
    id: "preview", tenant_id: "preview", subcontractor_id: "preview",
    employee_id: "preview", user_id: "preview", role: "subcontractor_admin", active: true,
  },
  subcontractor: {
    id: "preview", name: "Sample Haulage", subcontractor_type: "fleet", legal_name: "Sample Haulage Ltd",
    contact_name: "Alex Morgan", phone: null, email: "alex@example.test", operator_licence_number: null,
    goods_in_transit_expiry: null, public_liability_expiry: null, employers_liability_expiry: null,
    motor_insurance_expiry: null, adr_capable: false,
  },
  employee: {
    id: "preview", full_name: "Alex Morgan", email: "alex@example.test", phone: null, job_title: "Owner",
    directly_employed: true, active: true, owner: true,
  },
  jobs: [],
  vehicles: [],
  employees: [],
  portalUsers: [],
};

export default function SubcontractorPreviewPage() {
  return <Dashboard previewData={preview} />;
}
