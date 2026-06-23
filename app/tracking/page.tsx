"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";

export default function TrackingPage() {
  const supabase = createClient();

  const [vehicles, setVehicles] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  async function loadData() {
    const { data: vehicleData } = await supabase
      .from("vehicles")
      .select("id, registration")
      .eq("tenant_id", TENANT_ID)
      .eq("active", true);

    const { data: locationData } = await supabase
      .from("vehicle_locations")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .order("recorded_at", { ascending: false });

    setVehicles(vehicleData || []);
    setLocations(locationData || []);
  }

  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 10000);

    return () => clearInterval(interval);
  }, []);

  function getLatestLocation(vehicleId: any) {
    return locations.find((x: any) => x.vehicle_id === vehicleId);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage: "url('/GPS.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.65)",
          padding: 30,
          borderRadius: 20
        }}
      >
        <h1 style={{ color: "white" }}>Vehicle Tracking</h1>

        <div
          style={{
            background: "white",
            padding: 20,
            borderRadius: 14
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse"
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8 }}>Vehicle</th>
                <th style={{ textAlign: "left", padding: 8 }}>Latitude</th>
                <th style={{ textAlign: "left", padding: 8 }}>Longitude</th>
                <th style={{ textAlign: "left", padding: 8 }}>Speed</th>
                <th style={{ textAlign: "left", padding: 8 }}>Last update</th>
              </tr>
            </thead>

            <tbody>
              {vehicles.map((vehicle: any) => {
                const loc = getLatestLocation(vehicle.id);

                return (
                  <tr key={vehicle.id}>
                    <td style={{ padding: 8 }}>{vehicle.registration}</td>

                    <td style={{ padding: 8 }}>
                      {loc?.latitude ?? "-"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {loc?.longitude ?? "-"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {loc?.speed != null ? `${loc.speed} km/h` : "-"}
                    </td>

                    <td style={{ padding: 8 }}>
                      {loc?.recorded_at
                        ? new Date(loc.recorded_at).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}


