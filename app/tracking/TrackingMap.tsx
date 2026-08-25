"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";

import {
  pingLabel,
  signalState,
  type PositionReading,
} from "../../lib/tracking/position";
import type { TrackingStop } from "../../lib/tracking/types";

type Props = {
  stops: TrackingStop[];
  reading: PositionReading | null;
  now: Date;
};

type LatLng = {
  lat: number;
  lng: number;
};

type RouteResult = {
  points: LatLng[];
  legs: {
    distanceMeters: number;
    travelTimeSeconds: number;
  }[];
  totalDistanceMeters: number;
  totalTravelTimeSeconds: number;
};

const MAP_KEY = process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;
const HEIGHT = 360;
const DEFAULT_CENTER: [number, number] = [-1.5, 53];
const DEFAULT_ZOOM = 6;

function hasCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  );
}

function stopDescription(stop: TrackingStop): string {
  return [stop.address_line, stop.city, stop.postcode]
    .filter(Boolean)
    .join(", ");
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";

  const miles = metres / 1609.344;

  return miles < 10
    ? `${miles.toFixed(1)} mi`
    : `${Math.round(miles)} mi`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";

  const minutes = Math.max(0, Math.round(seconds / 60));

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder > 0
    ? `${hours} h ${remainder} min`
    : `${hours} h`;
}

function createStopMarker(
  stop: TrackingStop,
  index: number,
): HTMLDivElement {
  const element = document.createElement("div");

  const prefix =
    stop.type === "collection"
      ? "C"
      : stop.type === "delivery"
        ? "D"
        : "S";

  element.textContent = `${prefix}${index + 1}`;
  element.title = stopDescription(stop) || `Stop ${index + 1}`;

  element.style.cssText = [
    "width:30px",
    "height:30px",
    "border-radius:50%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 11px sans-serif",
    "background:var(--primary)",
    "color:var(--on-primary)",
    "border:2px solid var(--on-primary)",
    "box-shadow:0 2px 7px rgba(0,0,0,.38)",
  ].join(";");

  return element;
}

function createVehicleMarker(
  reading: PositionReading,
  state: ReturnType<typeof signalState>,
): HTMLDivElement {
  const element = document.createElement("div");
  const live = state === "live";

  element.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>' +
    '<path d="M15 18H9"/>' +
    '<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>' +
    '<circle cx="17" cy="18" r="2"/>' +
    '<circle cx="7" cy="18" r="2"/>' +
    "</svg>";
  element.title = live
    ? "Live vehicle position"
    : "Last known vehicle position";

  element.style.cssText = [
    "width:40px",
    "height:40px",
    "border-radius:50%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:white",
    live ? "background:#16a34a" : "background:#d97706",
    "border:3px solid white",
    "box-shadow:0 2px 9px rgba(0,0,0,.5)",
  ].join(";");

  if (
    reading.headingDeg !== null &&
    Number.isFinite(reading.headingDeg)
  ) {
    element.style.transform =
      `rotate(${reading.headingDeg}deg)`;
  }

  return element;
}

export default function TrackingMap({
  stops,
  reading,
  now,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const mapHandleRef = useRef<{
    tt: any;
    map: any;
  } | null>(null);

  const markerObjectsRef = useRef<any[]>([]);

  const [mapReady, setMapReady] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const state = signalState(reading, now);

  const mappedStops = useMemo(
    () =>
      stops.flatMap((stop) => {
        if (!hasCoordinates(stop.lat, stop.lng)) return [];

        return [
          {
            stop,
            position: {
              lat: stop.lat as number,
              lng: stop.lng as number,
            },
          },
        ];
      }),
    [stops],
  );

  const remainingStops = useMemo(
    () =>
      mappedStops.filter(
        ({ stop }) => !stop.delivered_at,
      ),
    [mappedStops],
  );

  const routePoints = useMemo(() => {
    const points: LatLng[] = [];

    if (
      reading &&
      Number.isFinite(reading.lat) &&
      Number.isFinite(reading.lng)
    ) {
      points.push({
        lat: reading.lat,
        lng: reading.lng,
      });
    }

    for (const { position } of remainingStops) {
      points.push(position);
    }

    return points.slice(0, 50);
  }, [reading, remainingStops]);

  useEffect(() => {
    if (!MAP_KEY || !containerRef.current || mapHandleRef.current) {
      return;
    }

    let cancelled = false;

    (async () => {
      const tt = (
        await import("@tomtom-international/web-sdk-maps")
      ).default;

      if (cancelled || !containerRef.current) return;

      const map = tt.map({
        key: MAP_KEY,
        container: containerRef.current,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });

      mapHandleRef.current = { tt, map };

      map.on("load", () => {
        if (!cancelled) setMapReady(true);
      });
    })().catch((error) => {
      console.error("Unable to initialise tracking map.", error);

      if (!cancelled) {
        setNotice("The map could not be loaded.");
      }
    });

    return () => {
      cancelled = true;

      markerObjectsRef.current.forEach((marker) => marker.remove());
      markerObjectsRef.current = [];

      mapHandleRef.current?.map?.remove();
      mapHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (routePoints.length < 2) {
      setRoute(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/tomtom/route", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            points: routePoints,
          }),
        });

        if (cancelled) return;

        if (!response.ok) {
          const body = await response.json().catch(() => null);

          setRoute(null);
          setNotice(body?.error ?? "Route calculation failed.");
          return;
        }

        const nextRoute =
          (await response.json()) as RouteResult;

        setRoute(nextRoute);
        setNotice(null);
      } catch {
        if (!cancelled) {
          setRoute(null);
          setNotice("Route calculation failed.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routePoints]);

  useEffect(() => {
    const handle = mapHandleRef.current;

    if (!handle || !mapReady) return;

    const { tt, map } = handle;

    markerObjectsRef.current.forEach((marker) => marker.remove());
    markerObjectsRef.current = [];

    mappedStops.forEach(({ stop, position }, index) => {
      const marker = new tt.Marker({
        element: createStopMarker(stop, index),
      })
        .setLngLat([position.lng, position.lat])
        .addTo(map);

      markerObjectsRef.current.push(marker);
    });

    if (
      reading &&
      Number.isFinite(reading.lat) &&
      Number.isFinite(reading.lng)
    ) {
      const marker = new tt.Marker({
        element: createVehicleMarker(reading, state),
      })
        .setLngLat([reading.lng, reading.lat])
        .addTo(map);

      markerObjectsRef.current.push(marker);
    }

    if (map.getLayer("tracking-route")) {
      map.removeLayer("tracking-route");
    }

    if (map.getSource("tracking-route")) {
      map.removeSource("tracking-route");
    }

    if (route && route.points.length >= 2) {
      map.addSource("tracking-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: route.points.map(
              (point) => [point.lng, point.lat],
            ),
          },
        },
      });

      map.addLayer({
        id: "tracking-route",
        type: "line",
        source: "tracking-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
          "line-opacity": 0.85,
        },
      });
    }

    const fitPoints: LatLng[] = mappedStops.map(
      ({ position }) => position,
    );

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

    if (route) {
      fitPoints.push(...route.points);
    }

    if (fitPoints.length === 0) return;

    if (fitPoints.length === 1) {
      map.easeTo({
        center: [
          fitPoints[0].lng,
          fitPoints[0].lat,
        ],
        zoom: 13,
        duration: 300,
      });

      return;
    }

    const lats = fitPoints.map((point) => point.lat);
    const lngs = fitPoints.map((point) => point.lng);

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: 52,
        maxZoom: 14,
        duration: 350,
      },
    );
  }, [
    mappedStops,
    reading,
    route,
    state,
    mapReady,
  ]);

  if (!MAP_KEY) {
    return (
      <section
        aria-label="Vehicle position map"
        className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 p-6 text-center shadow-sm"
        style={{ height: HEIGHT }}
      >
        <p className="text-sm font-semibold text-ink-2">
          TomTom tracking map is not configured.
        </p>

        <p className="max-w-[46ch] text-xs text-ink-3">
          Set NEXT_PUBLIC_TOMTOM_MAP_KEY. Tracking data continues to work without map tiles.
        </p>
      </section>
    );
  }

  const unmappedCount = stops.length - mappedStops.length;

  return (
    <section
      aria-label="Vehicle position map"
      className="relative overflow-hidden rounded-lg border border-line bg-surface-2 shadow-sm"
    >
      <div
        ref={containerRef}
        style={{ height: HEIGHT }}
      />

      <div className="absolute left-2 top-2 flex flex-wrap gap-2">
        <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink shadow-sm">
          {state === "live"
            ? `Live · ${pingLabel(reading, now)}`
            : state === "stale"
              ? `Last known · ${pingLabel(reading, now)}`
              : "No vehicle GPS"}
        </span>

        <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 shadow-sm">
          {mappedStops.length} mapped{" "}
          {mappedStops.length === 1 ? "stop" : "stops"}
        </span>

        {route ? (
          <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 shadow-sm">
            {formatDistance(route.totalDistanceMeters)} ·{" "}
            {formatDuration(route.totalTravelTimeSeconds)}
          </span>
        ) : null}
      </div>

      {unmappedCount > 0 ? (
        <p className="absolute bottom-2 left-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-warning shadow-sm">
          {unmappedCount}{" "}
          {unmappedCount === 1 ? "stop has" : "stops have"} no map coordinates yet.
        </p>
      ) : notice ? (
        <p className="absolute bottom-2 left-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-warning shadow-sm">
          {notice}
        </p>
      ) : null}
    </section>
  );
}