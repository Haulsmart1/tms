export default function SuperAdminPage() {

    const stats = [
        {
            title: "Companies",
            value: "24",
            description: "Active companies using TMS",
            icon: "🏢",
        },
        {
            title: "Vehicles",
            value: "186",
            description: "Total registered vehicles",
            icon: "🚚",
        },
        {
            title: "Users",
            value: "93",
            description: "Active system users",
            icon: "👥",
        },
        {
            title: "Monthly Revenue",
            value: "£4,320",
            description: "Vehicle based billing",
            icon: "💷",
        },
    ];


    const links = [
        {
            title: "Companies",
            description: "View and manage customer companies",
            href: "/super-admin/companies",
            icon: "🏢",
        },
        {
            title: "Users",
            description: "Manage platform users",
            href: "/super-admin/users",
            icon: "👥",
        },
        {
            title: "Billing",
            description: "Vehicle based billing configuration",
            href: "/super-admin/billing",
            icon: "💷",
        },
        {
            title: "Invoices",
            description: "Generate and track invoices",
            href: "/super-admin/invoices",
            icon: "📄",
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
                    <h1 style={{ marginTop: 0, fontSize: 38 }}>
                        Super Admin Dashboard
                    </h1>

                    <p style={{ opacity: 0.85 }}>
                        Platform management, billing and company overview.
                    </p>
                </div>


                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 20,
                        marginBottom: 30,
                    }}
                >

                    {stats.map((item) => (

                        <div
                            key={item.title}
                            style={{
                                background: "rgba(255,255,255,0.95)",
                                padding: 20,
                                borderRadius: 14,
                                boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
                            }}
                        >

                            <div style={{ fontSize: 28, marginBottom: 8 }}>
                                {item.icon}
                            </div>

                            <h2 style={{ margin: 0 }}>
                                {item.value}
                            </h2>

                            <p
                                style={{
                                    margin: "4px 0 0 0",
                                    fontWeight: 600,
                                }}
                            >
                                {item.title}
                            </p>

                            <p
                                style={{
                                    margin: 0,
                                    color: "#555",
                                    fontSize: 14,
                                }}
                            >
                                {item.description}
                            </p>

                        </div>

                    ))}

                </div>



                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: 20,
                    }}
                >

                    {links.map((card) => (

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

                            <div
                                style={{
                                    fontSize: 30,
                                    marginBottom: 10,
                                }}
                            >
                                {card.icon}
                            </div>

                            <h2
                                style={{
                                    marginTop: 0,
                                    marginBottom: 6,
                                }}
                            >
                                {card.title}
                            </h2>

                            <p
                                style={{
                                    margin: 0,
                                    color: "#555",
                                }}
                            >
                                {card.description}
                            </p>

                        </a>

                    ))}

                </div>

            </div>

        </main>
    );
}
