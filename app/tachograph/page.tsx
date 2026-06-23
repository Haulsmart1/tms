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

                    <h1>Tachograph</h1>

                    <p>EU Drivers Hours & WTD compliance</p>

                </div>


                {loading && <p style={{ color: "white" }}>Loading...</p>}


                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                        gap: 20,
                        marginBottom: 30
                    }}
                >

                    {drivers.map(driver => (

                        <div key={driver.id} style={cardStyle}>

                            <h3>{driver.name}</h3>

                            <p>{driver.driver_type}</p>

                        </div>

                    ))}

                </div>



                <h2 style={{ color: "white" }}>Recent Activity</h2>


                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                        gap: 20
                    }}
                >

                    {logs.map(log => (

                        <div key={log.id} style={cardStyle}>

                            <strong>{log.activity_type}</strong>

                            <p>

                                {new Date(log.start_time).toLocaleString()}

                            </p>

                            <p>

                                {Math.round(log.duration_minutes || 0)} mins

                            </p>

                        </div>

                    ))}

                </div>

            </div>

        </main>

    );

}
