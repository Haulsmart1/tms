import Link from "next/link";
import { Building2, Truck, Users, Banknote, FileText, type LucideIcon } from "lucide-react";
import Stat from "../../components/Stat";

export default function SuperAdminPage() {

    const stats: Array<{ title: string; value: string; description: string; icon: LucideIcon }> = [
        {
            title: "Companies",
            value: "24",
            description: "Active companies using TMS",
            icon: Building2,
        },
        {
            title: "Vehicles",
            value: "186",
            description: "Total registered vehicles",
            icon: Truck,
        },
        {
            title: "Users",
            value: "93",
            description: "Active system users",
            icon: Users,
        },
        {
            title: "Monthly Revenue",
            value: "£4,320",
            description: "Vehicle based billing",
            icon: Banknote,
        },
    ];


    const links: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
        {
            title: "Companies",
            description: "View and manage customer companies",
            href: "/super-admin/companies",
            icon: Building2,
        },
        {
            title: "Users",
            description: "Manage platform users",
            href: "/super-admin/users",
            icon: Users,
        },
        {
            title: "Billing",
            description: "Vehicle based billing configuration",
            href: "/super-admin/billing",
            icon: Banknote,
        },
        {
            title: "Invoices",
            description: "Generate and track invoices",
            href: "/super-admin/invoices",
            icon: FileText,
        },
    ];


    return (
        /* Matches /super-admin/requests. The photo background and dark scrim
           that used to live here are gone on purpose: the console has one
           surface language and this area was the only thing outside it. */
        <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
            <div className="mx-auto w-full max-w-6xl">
                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Platform</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                        Super Admin Dashboard
                    </h1>

                    <p className="m-0 text-sm text-ink-3">
                        Platform management, billing and company overview.
                    </p>
                </header>

                {/* The four figures below are HARDCODED placeholders, not live
                    platform numbers, and they were before this page moved onto
                    the design system. Saying so on screen matters more now than
                    it did: dressed as real console stat tiles they read as
                    authoritative. Making this page data-driven is on the README
                    roadmap; until then the label is what keeps it honest. */}
                <div className="mb-2 text-xs font-medium text-warning-strong">
                    Sample figures, not live platform data.
                </div>

                <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                    {stats.map((item) => (
                        <Stat
                            key={item.title}
                            label={item.title}
                            value={item.value}
                            sub={item.description}
                        />
                    ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {links.map((card) => (
                        <Link
                            key={card.href}
                            href={card.href}
                            className="block rounded-lg border border-line bg-surface p-4 no-underline shadow-sm hover:border-primary-tint-border hover:shadow-md"
                        >
                            <span className="mb-2 block text-ink-3">
                                <card.icon size={28} aria-hidden />
                            </span>

                            <h2 className="m-0 mb-1 text-md font-semibold text-ink">
                                {card.title}
                            </h2>

                            <p className="m-0 text-sm text-ink-3">{card.description}</p>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
