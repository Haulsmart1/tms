import { canViewSubcontractorInvoices, portalScopeFor } from "./portalScope";

export function subcontractorSections(role: string) {
  const scope = portalScopeFor(role);
  return [
    { id: "assigned-jobs", label: "Jobs", visible: scope.jobs },
    { id: "vehicles", label: "Vehicles", visible: scope.vehicles },
    { id: "company-details", label: "Company details", visible: scope.portalUsers },
    { id: "invoices", label: "Invoices", visible: canViewSubcontractorInvoices(role) },
    { id: "portal-users", label: "Portal users", visible: scope.portalUsers },
  ].filter((section) => section.visible);
}

export function activeSubcontractorSection(role: string, hash: string): string | undefined {
  const sections = subcontractorSections(role);
  const selected = hash.replace(/^#/, "");
  return sections.find((section) => section.id === selected)?.id ?? sections[0]?.id;
}
