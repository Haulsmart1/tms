"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import Stat from "../../../components/Stat";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";

export default function BillingPage() {

    const supabase = createClient();

    const [count, setCount] = useState(0);

    useEffect(() => {

        load();

    }, []);

    async function load() {

        const { data } = await supabase
            .from("vehicle_licences")
            .select("vehicle_id")
            .eq("active", true);

        const unique = new Set(data?.map(x => x.vehicle_id));

        setCount(unique.size);

    }

    return (

        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Admin</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Billing</h1>
                </header>

                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                    <Stat
                        label="4-Weekly Charge"
                        value={formatPence(computeChargeAmounts(count).grossPence)}
                        sub={`${count} licensed vehicles here, inc VAT`}
                    />
                </div>

            </main>
        </div>

    )

}
