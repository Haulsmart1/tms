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


    const cardStyle = {

        background: "rgba(255,255,255,0.95)",
        padding: 20,
        borderRadius: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,0.25)"

    };


    return (

        <main
            style={{
                minHeight: "100vh",
                padding: 30,
                backgroundImage:
                    "url('https://images.unsplash.com/photo-1553413077-190dd305871c')",
                backgroundSize: "cover"
            }}
        >

            <div
                style={{
                    background: "rgba(0,0,0,0.65)",
                    padding: 30,
                    borderRadius: 20
                }}
            >

                <div style={{ color: "white", marginBottom: 20 }}>

                    <h1>Telematics</h1>

                    <p>Vehicle GPS tracking and performance data</p>

                </div>


                {loading && <p style={{ color: "white" }}>Loading...</p>}


                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                        gap: 20
                    }}
                >

                    {positions.map(p => (

                        <div key={p.id} style={cardStyle}>

                            <strong>Vehicle Position</strong>

                            <p>Latitude: {p.latitude}</p>

                            <p>Longitude: {p.longitude}</p>

                            <p>Speed: {p.speed} km/h</p>

                            <p>
                                {new Date(p.recorded_at).toLocaleString()}
                            </p>

                        </div>

                    ))}

                </div>

            </div>

        </main>

    );

}
