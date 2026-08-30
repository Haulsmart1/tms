"use client";

import { useEffect, useRef, useState } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";
import {
  pingLabel,
  signalState,
  type PositionReading,
} from "../../lib/tracking/position";
import type { LatLng, RouteResult } from "../../lib/planning/types";

export type MapMarker = { position: LatLng; label: string };

type Props = {
  markers: MapMarker[];
  route: RouteResult | null;
  /** Non-null renders an overlay chip: route fetch failed, stops unroutable, etc. */
  notice: string | null;
  reading: PositionReading | null;
  now: Date;
};

/* THE PLANNING MAP MOUNT.

   The SDK touches `window` at import time, so it is loaded with a dynamic
   import inside an effect rather than at module top. Everything TomTom is
   confined to this file: the page hands in plain markers and a RouteResult
   and knows nothing about tt.Marker or geojson sources.

   With no NEXT_PUBLIC_TOMTOM_MAP_KEY this renders a labelled placeholder in
   the TrackingMap mould: an honest statement, not a spinner pretending tiles
   are on the way. The board around it keeps working either way. */

const MAP_KEY = process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;
const HEIGHT = 380;
// Roughly central England, wide enough to see a UK operation before data loads.
const DEFAULT_CENTER: [number, number] = [-1.5, 53.0];
const DEFAULT_ZOOM = 6;

export default function PlanningMap({
  markers,
  route,
  notice,
  reading,
  now,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<{ tt: any; map: any } | null>(null);
  const markerObjsRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const vehicleSignal = signalState(reading, now);

  useEffect(() => {
    if (!MAP_KEY || !containerRef.current || handleRef.current) return;
    let cancelled = false;
    (async () => {
      const tt = (await import("@tomtom-international/web-sdk-maps")).default;
      if (cancelled || !containerRef.current) return;
      const map = tt.map({
        key: MAP_KEY,
        container: containerRef.current,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });
      handleRef.current = { tt, map };
      // "load" fires once the style is ready; layers added before it throw.
      map.on("load", () => setReady(true));
    })();
    return () => {
      cancelled = true;
      handleRef.current?.map?.remove();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !ready) return;
    const { tt, map } = handle;

    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = markers.map((m) => {
      const el = document.createElement("div");
      el.textContent = m.label;
      // A real DOM node inside the page, so the design tokens apply: the
      // numbered pin reads as a primary-filled control in either theme.
      el.style.cssText =
        "width:26px;height:26px;border-radius:50%;background:var(--primary);color:var(--on-primary);" +
        "display:flex;align-items:center;justify-content:center;" +
        "font:600 13px sans-serif;border:2px solid var(--on-primary);box-shadow:0 1px 4px rgba(0,0,0,.4)";
      return new tt.Marker({ element: el })
        .setLngLat([m.position.lng, m.position.lat])
        .addTo(map);
    });

    if (
      reading &&
      Number.isFinite(reading.lat) &&
      Number.isFinite(reading.lng)
    ) {
      const el = document.createElement("div");
      const live = vehicleSignal === "live";

      el.textContent = "V";
      el.title = live
        ? `Live vehicle position - ${pingLabel(reading, now)}`
        : `Last known vehicle position - ${pingLabel(reading, now)}`;
      el.style.cssText = [
        "width:38px",
        "height:38px",
        "border-radius:50%",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-size:20px",
        "background:var(--surface)",
        "border:3px solid var(--primary)",
        "box-shadow:0 2px 9px rgba(0,0,0,.5)",
        live ? "opacity:1" : "opacity:.58",
      ].join(";");

      const vehicleMarker = new tt.Marker({ element: el })
        .setLngLat([reading.lng, reading.lat])
        .addTo(map);

      markerObjsRef.current.push(vehicleMarker);
    }

    if (map.getLayer("plan-route")) map.removeLayer("plan-route");
    if (map.getSource("plan-route")) map.removeSource("plan-route");
    if (route && route.points.length >= 2) {
      map.addSource("plan-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.points.map((p) => [p.lng, p.lat]),
          },
        },
      });
      map.addLayer({
        id: "plan-route",
        type: "line",
        source: "plan-route",
        layout: { "line-cap": "round", "line-join": "round" },
        // Concrete hex on purpose: this paints on the map-gl WebGL canvas, which
        // cannot resolve CSS variables. Do not "fix" it to var(--something).
        paint: { "line-color": "#e2574c", "line-width": 4 },
      });
    }

    const fitPoints = markers.map((marker) => marker.position);

    if (
      reading &&
      Number.isFinite(reading.lat) &&
      Number.isFinite(reading.lng)
    ) {
      fitPoints.push({
        lat: reading.lat,
        lng: reading.lng,
      });
    }

    if (fitPoints.length > 0) {
      const lats = fitPoints.map((point) => point.lat);
      const lngs = fitPoints.map((point) => point.lng);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 14, duration: 300 }
      );
    }
  }, [markers, route, reading, vehicleSignal, ready, now]);

  if (!MAP_KEY) {
    return (
      <section
        aria-label="Route map"
        className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 p-6 text-center shadow-sm"
        style={{ height: HEIGHT }}
      >
        <p className="text-sm font-semibold text-ink-2">
          The route map appears here once the TomTom map key is configured.
        </p>
        <p className="max-w-[46ch] text-xs text-ink-3">
          Set NEXT_PUBLIC_TOMTOM_MAP_KEY. Assigning and sequencing jobs works without it.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Route map" className="relative overflow-hidden rounded-lg border border-line shadow-sm">
      <div ref={containerRef} style={{ height: HEIGHT }} />

      <div className="absolute left-2 top-2">
        <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-sm">
          {vehicleSignal === "live"
            ? `Live vehicle - ${pingLabel(reading, now)}`
            : vehicleSignal === "stale"
              ? `Last known vehicle - ${pingLabel(reading, now)}`
              : "No vehicle GPS"}
        </span>
      </div>

      {notice ? (
        <p className="absolute bottom-2 left-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 shadow-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
