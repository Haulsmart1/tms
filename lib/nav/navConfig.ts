// Console's nav taxonomy. Icon names are lucide-react export names (PascalCase),
// kept as strings here so this file stays pure data — AppShell maps them to
// actual icon components, so this config has zero React/JSX dependency.
export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" }],
  },
  {
    label: "Operations",
    items: [
      { id: "jobs", label: "Jobs", href: "/jobs", icon: "ClipboardList" },
      { id: "pod", label: "Proof of delivery", href: "/pod", icon: "CircleCheck" },
      { id: "tracking", label: "Tracking", href: "/tracking", icon: "MapPin" },
      { id: "invoices", label: "Invoices", href: "/invoices", icon: "Receipt" },
      { id: "customers", label: "Customers", href: "/customers", icon: "Building2" },
      { id: "subcontractors", label: "Subcontractors", href: "/subcontractors", icon: "Users" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { id: "vehicles", label: "Vehicles", href: "/vehicles", icon: "Truck" },
      { id: "drivers", label: "Drivers", href: "/drivers", icon: "User" },
      { id: "assets", label: "Assets", href: "/assets", icon: "Boxes" },
      { id: "maintenance", label: "Maintenance", href: "/maintenance", icon: "TriangleAlert" },
    ],
  },
  {
    label: "Compliance",
    items: [
      { id: "tachograph", label: "Tachograph", href: "/tachograph", icon: "Gauge" },
      { id: "telematics", label: "Telematics", href: "/telematics", icon: "Navigation" },
    ],
  },
  {
    label: "Insights",
    items: [{ id: "stats", label: "Stats", href: "/stats", icon: "ArrowUpRight" }],
  },
  {
    label: "Admin",
    items: [{ id: "settings", label: "Settings", href: "/settings", icon: "Settings" }],
  },
];
