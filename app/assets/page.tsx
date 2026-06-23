"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

export default function AssetsPage() {

    const supabase = createClient();

    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [name, setName] = useState("");
    const [type, setType] = useState("");
    const [serial, setSerial] = useState("");
    const [notes, setNotes] = useState("");

    async function loadAssets() {

        setLoading(true);

        const { data, error } = await supabase
            .from("assets")
            .select("*")
            .order("created_at", { ascending: false });

        if (!error && data) {
            setAssets(data);
        }

        setLoading(false);
    }


    async function createAsset(e: any) {

        e.preventDefault();

        await supabase.from("assets").insert({

            name,
            asset_type: type,
            serial_number: serial,
            notes

        });

        setName("");
        setType("");
        setSerial("");
        setNotes("");

        loadAssets();
    }


    useEffect(() => {
        loadAssets();
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

                    <h1>Assets</h1>

                    <p>Track trailers, pallets and equipment</p>

                </div>



                <form
                    onSubmit={createAsset}
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                        gap: 12,
                        marginBottom: 30
                    }}
                >

                    <input
                        placeholder="Asset name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />

                    <select
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        required
                    >

                        <option value="">Type</option>

                        <option>Trailer</option>

                        <option>Pallet</option>

                        <option>Container</option>

                        <option>Cage</option>

                        <option>Forklift</option>

                        <option>Fridge Unit</option>

                        <option>Telematics Device</option>

                        <option>Tachograph Unit</option>

                    </select>


                    <input
                        placeholder="Serial / Ref"
                        value={serial}
                        onChange={(e) => setSerial(e.target.value)}
                    />

                    <input
                        placeholder="Notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />

                    <button
                        style={{
                            background: "#2563eb",
                            color: "white",
                            border: "none",
                            borderRadius: 8,
                            padding: 12,
                            cursor: "pointer"
                        }}
                    >

                        Add Asset

                    </button>

                </form>



                {loading && <p style={{ color: "white" }}>Loading...</p>}



                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
                        gap: 20
                    }}
                >

                    {assets.map((asset) => (

                        <div key={asset.id} style={cardStyle}>

                            <h3>{asset.name}</h3>

                            <p>{asset.asset_type}</p>

                            {asset.serial_number && (

                                <p>Ref: {asset.serial_number}</p>

                            )}

                            {asset.notes && (

                                <p>{asset.notes}</p>

                            )}

                        </div>

                    ))}

                </div>


            </div>

        </main>

    );

}
