"use client";

import { useEffect, useRef } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";

type LatLng = { lat: number; lng: number };
type Position = LatLng & { at: string };
type MapHandle = { tt: any; map: any; van: any | null };

const MAP_KEY = process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;

/* Van and destination only. Never draws any other stop. */
function drawVan(h: MapHandle, position: Position | null, destination: LatLng) {
  h.van?.remove();
  h.van = null;
  if (!position) return;
  h.van = new h.tt.Marker({ color: "#1d4ed8" }).setLngLat([position.lng, position.lat]).addTo(h.map);
  const bounds = new h.tt.LngLatBounds();
  bounds.extend([position.lng, position.lat]);
  bounds.extend([destination.lng, destination.lat]);
  h.map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
}

export default function TrackMap({ position, destination }: { position: Position | null; destination: LatLng }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handle = useRef<MapHandle | null>(null);
  /* The latest position, so the van is drawn as soon as the map finishes
     loading even when the first poll answered before the SDK did. */
  const latest = useRef<Position | null>(position);
  latest.current = position;

  useEffect(() => {
    if (!MAP_KEY || !containerRef.current || handle.current) return;
    let cancelled = false;
    void (async () => {
      const tt = (await import("@tomtom-international/web-sdk-maps")).default;
      if (cancelled || !containerRef.current) return;
      const map = tt.map({ key: MAP_KEY, container: containerRef.current, center: [destination.lng, destination.lat], zoom: 11 });
      new tt.Marker({ color: "#047857" }).setLngLat([destination.lng, destination.lat]).addTo(map);
      handle.current = { tt, map, van: null };
      drawVan(handle.current, latest.current, destination);
    })();
    return () => {
      cancelled = true;
      handle.current?.map.remove();
      handle.current = null;
    };
    // The destination object is rebuilt on every poll; only its coordinates matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.lat, destination.lng]);

  useEffect(() => {
    if (handle.current) drawVan(handle.current, position, destination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng, position?.at, destination.lat, destination.lng]);

  if (!MAP_KEY) return null;
  return <div ref={containerRef} className="h-72 w-full" aria-label="Map showing the delivery vehicle and your address" />;
}
