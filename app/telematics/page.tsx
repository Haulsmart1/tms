"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

export default function TelematicsPage() {

    const supabase = createClient();

    const [positions, setPositions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    async function loadPositions() {

        setLoading(true);

        const { data } = await supabase
            .from("telematics_positions")
            .select("*")
            .order("recorded_at", { ascending: false })
            .limit(20);

        setPositions(data || []);

        setLoading(false);

    }

    useEffect(() => {
        loadPositions();
    }, []);


    return (

        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <div className="text-kicker uppercase text-ink-3">Compliance</div>

                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Telematics</h1>

                <p className="mb-4 text-sm text-ink-3">Vehicle GPS tracking and performance data</p>


                {loading && <p className="text-sm text-ink-3">Loading...</p>}


                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">

                    {positions.map(p => (

                        <article key={p.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">

                            <strong className="text-sm font-semibold text-ink">Vehicle Position</strong>

                            <p className="font-mono text-sm text-ink-2">Latitude: {p.latitude}</p>

                            <p className="font-mono text-sm text-ink-2">Longitude: {p.longitude}</p>

                            <p className="font-mono text-sm text-ink-2">Speed: {p.speed} km/h</p>

                            <p className="font-mono text-sm text-ink-2">
                                {new Date(p.recorded_at).toLocaleString()}
                            </p>

                        </article>

                    ))}

                </div>

            </main>
        </div>

    );

}
