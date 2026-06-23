export default function SettingsPage() {
    const cards = [
        {
            title: "Company Profile",
            description:
                "Edit company details, VAT, EORI, operator licence, US EIN, USDOT, MC and regional settings",
            href: "/settings/company",
            icon: "🏢",
        },
        {
            title: "Users",
            description: "Add users and manage account access",
            href: "/settings/users",
            icon: "👥",
        },
        {
            title: "Page Permissions",
            description: "Control which pages each user can access",
            href: "/settings/permissions",
            icon: "🔐",
        },
        {
            title: "Vehicle Licences",
            description: "Add or remove licences and manage £10 monthly billing",
            href: "/settings/licences",
            icon: "📄",
        },
        {
            title: "Invoices",
            description: "View billing and invoice settings",
            href: "/settings/invoices",
            icon: "💷",
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
                    background: "rgba(0,0,0,0.65)",
                    padding: 30,
                    borderRadius: 20,
                }}
            >
                <div style={{ color: "white", marginBottom: 30 }}>
                    <h1 style={{ marginTop: 0, fontSize: 38 }}>Settings</h1>
                    <p style={{ opacity: 0.85, marginBottom: 0 }}>
                        Manage company details, users, permissions, vehicle licences and billing settings.
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
