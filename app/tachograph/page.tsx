"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

export default function TachographPage() {

    const supabase = createClient();

    const [drivers, setDrivers] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadData() {

        setLoading(true);

        const { data: driverData } = await supabase
            .from("drivers")
            .select("id,name,driver_type");

        const { data: logData } = await supabase
            .from("driver_activity_logs")
            .select("*")
            .order("start_time", { ascending: false })
            .limit(20);

        setDrivers(driverData || []);
        setLogs(logData || []);

        setLoading(false);
    }


    useEffect(() => {
        loadData();
    }, []);


    return (

        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <div className="text-kicker uppercase text-ink-3">Compliance</div>

                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Tachograph</h1>

                <p className="mb-4 text-sm text-ink-3">EU Drivers Hours &amp; WTD compliance</p>


                {loading && <p className="text-sm text-ink-3">Loading...</p>}


                <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">

                    {drivers.map(driver => (

                        <article key={driver.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">

                            <h3 className="mb-1 text-md font-semibold text-ink">{driver.name}</h3>

                            <p className="text-sm text-ink-3">{driver.driver_type}</p>

                        </article>

                    ))}

                </div>



                <h2 className="mb-2 mt-6 text-md font-semibold text-ink">Recent Activity</h2>


                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">

                    {logs.map(log => (

                        <article key={log.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">

                            <strong className="text-sm font-semibold text-ink">{log.activity_type}</strong>

                            <p className="font-mono text-sm text-ink-2">

                                {new Date(log.start_time).toLocaleString()}

                            </p>

                            <p className="font-mono text-sm text-ink-2">

                                {Math.round(log.duration_minutes || 0)} mins

                            </p>

                        </article>

                    ))}

                </div>

            </main>
        </div>

    );

}
