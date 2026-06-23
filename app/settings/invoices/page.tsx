"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

const PRICE = 10;

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

        <main style={pageStyle}>

            <div style={overlayStyle}>

                <h1 style={titleStyle}>Billing</h1>

                <div style={cardStyle}>

                    <h2>Monthly Charge</h2>

                    <h1>£{count * PRICE}</h1>

                    <p>{count} licensed vehicles</p>

                </div>

            </div>

        </main>

    )

}

const pageStyle = { minHeight: "100vh", padding: 30, backgroundImage: "url('https://images.unsplash.com/photo-1553413077-190dd305871c')", backgroundSize: "cover" }

const overlayStyle = { background: "rgba(0,0,0,0.65)", padding: 30, borderRadius: 20 }

const titleStyle = { color: "white" }

const cardStyle = { background: "white", padding: 20, borderRadius: 14 }
