import { Building2, Users, Lock, FileText, Banknote, type LucideIcon } from "lucide-react";

export default function SettingsPage() {
    const cards: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
        {
            title: "Company Profile",
            description:
                "Edit company details, VAT, EORI, operator licence, US EIN, USDOT, MC and regional settings",
            href: "/settings/company",
            icon: Building2,
        },
        {
            title: "Users",
            description: "Add users and manage account access",
            href: "/settings/users",
            icon: Users,
        },
        {
            title: "Page Permissions",
            description: "Control which pages each user can access",
            href: "/settings/permissions",
            icon: Lock,
        },
        {
            title: "Vehicle Licences",
            description: "Add or remove licences and manage £10 monthly billing",
            href: "/settings/licences",
            icon: FileText,
        },
        {
            title: "Documents & Branding",
            description:
                "Manage logos, document branding, footers and quotation defaults",
            href: "/settings/documents",
            icon: FileText,
        },
        {
            title: "Invoices",
            description: "View billing and invoice settings",
            href: "/settings/invoices",
            icon: Banknote,
        },
    ];

    return (
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Admin</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Settings</h1>

                    <p className="m-0 text-sm text-ink-3">
                        Manage company details, users, permissions, vehicle licences and billing settings.
                    </p>
                </header>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {cards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <a
                                key={card.href}
                                href={card.href}
                                className="block rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-primary-tint-border hover:shadow-md"
                            >
                                <div
                                    aria-hidden
                                    className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary-tint text-primary-deep"
                                >
                                    <Icon size={18} />
                                </div>
                                <h2 className="mb-1 mt-0 text-md font-semibold text-ink">{card.title}</h2>
                                <p className="m-0 text-sm text-ink-3">{card.description}</p>
                            </a>
                        );
                    })}
                </div>

            </main>
        </div>
    );
}
