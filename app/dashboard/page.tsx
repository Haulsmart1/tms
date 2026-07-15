export default function DashboardPage() {
  const cards = [
    {
      title: "Stats",
      description: "Company KPIs, revenue and performance",
      href: "/stats",
      icon: "📊",
    },
    {
      title: "Jobs",
      description: "Create jobs with multi collection & delivery stops",
      href: "/jobs",
      icon: "📦",
    },
    {
      title: "POD",
      description: "Upload delivery photos & documents",
      href: "/pod",
      icon: "📸",
    },
    {
      title: "Invoices",
      description: "Create invoices and track payments",
      href: "/invoices",
      icon: "💷",
    },
    {
      title: "Customers",
      description: "Manage customer details",
      href: "/customers",
      icon: "🏢",
    },
    {
      title: "Subcontractors",
      description: "Manage external drivers & vehicles",
      href: "/subcontractors",
      icon: "🚛",
    },
    {
      title: "Vehicles",
      description: "Fleet management",
      href: "/vehicles",
      icon: "🚚",
    },
    {
      title: "Drivers",
      description: "Driver management",
      href: "/drivers",
      icon: "👤",
    },
    {
      title: "Tracking",
      description: "Live vehicle GPS tracking",
      href: "/tracking",
      icon: "📍",
    },
    {
      title: "Assets",
      description: "Track trailers, pallets and equipment",
      href: "/assets",
      icon: "📋",
    },
    {
      title: "Tachograph",
      description: "Driver hours and compliance",
      href: "/tachograph",
      icon: "⏱️",
    },
    {
      title: "Telematics",
      description: "Vehicle performance and data",
      href: "/telematics",
      icon: "📡",
    },
    {
      title: "Maintenance",
      description: "Vehicle service records",
      href: "/maintenance",
      icon: "🔧",
    },
    {
      title: "Settings",
      description: "Users, vehicles and billing",
      href: "/settings",
      icon: "⚙️",
    },
  ];

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.55)",
          padding: 30,
          borderRadius: 20,
        }}
      >
        <div style={{ color: "white", marginBottom: 30 }}>
          <h1 style={{ marginTop: 0, fontSize: 38 }}>TMS Wizzard Dashboard</h1>
          <p style={{ opacity: 0.85 }}>
            Manage transport jobs, POD, invoicing and fleet operations.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          {cards.map((card) => (
            <a
              key={card.href}
              href={card.href}
              style={{
                background: "rgba(255,255,255,0.95)",
                padding: 22,
                borderRadius: 14,
                textDecoration: "none",
                color: "#111",
                boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
                display: "block",
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 10 }}>{card.icon}</div>
              <h2 style={{ marginTop: 0, marginBottom: 6 }}>{card.title}</h2>
              <p style={{ margin: 0, color: "#555" }}>{card.description}</p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
