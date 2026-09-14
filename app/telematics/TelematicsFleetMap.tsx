"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";
import type {
  FleetVehicleState,
} from "../../lib/telematics/fleet";

type Props = {
  vehicles: FleetVehicleState[];
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string) => void;
};

const MAP_KEY =
  process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;

const DEFAULT_CENTER: [number, number] = [
  -1.5,
  53,
];

const DEFAULT_ZOOM = 6;

export default function TelematicsFleetMap({
  vehicles,
  selectedVehicleId,
  onSelect,
}: Props) {
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const mapHandleRef =
    useRef<{
      tt: any;
      map: any;
    } | null>(null);

  const markersRef =
    useRef<any[]>([]);

  const [ready, setReady] =
    useState(false);

  useEffect(() => {
    if (
      !MAP_KEY ||
      !containerRef.current ||
      mapHandleRef.current
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const tt = (
        await import(
          "@tomtom-international/web-sdk-maps"
        )
      ).default;

      if (
        cancelled ||
        !containerRef.current
      ) {
        return;
      }

      const map = tt.map({
        key: MAP_KEY,
        container:
          containerRef.current,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
      });

      map.addControl(
        new tt.NavigationControl()
      );

      mapHandleRef.current = {
        tt,
        map,
      };

      map.on("load", () => {
        if (!cancelled) {
          setReady(true);
        }
      });
    })();

    return () => {
      cancelled = true;

      for (
        const marker of markersRef.current
      ) {
        marker.remove();
      }

      markersRef.current = [];

      mapHandleRef.current?.map?.remove();
      mapHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handle = mapHandleRef.current;

    if (!handle || !ready) {
      return;
    }

    for (
      const marker of markersRef.current
    ) {
      marker.remove();
    }

    markersRef.current = [];

    const mapped = vehicles.filter(
      (vehicle) =>
        vehicle.reading &&
        Number.isFinite(
          vehicle.reading.lat
        ) &&
        Number.isFinite(
          vehicle.reading.lng
        )
    );

    for (const vehicle of mapped) {
      const reading = vehicle.reading;

      if (!reading) {
        continue;
      }

      const element =
        document.createElement("button");

      element.type = "button";
      element.title =
        `${vehicle.registration} ? ` +
        (
          vehicle.signalStatus === "live"
            ? "live position"
            : "last known position"
        );

      element.style.cursor = "pointer";
      element.style.border = "0";
      element.style.padding = "0";
      element.style.background = "transparent";

      const chip =
        document.createElement("span");

      chip.textContent =
        vehicle.registration;

      chip.style.cssText = [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "min-width:44px",
        "height:28px",
        "padding:0 8px",
        "border-radius:999px",
        "font-size:11px",
        "font-weight:700",
        "white-space:nowrap",
        "background:var(--surface)",
        "color:var(--ink)",
        vehicle.id === selectedVehicleId
          ? "border:2px solid currentColor"
          : "border:1px solid currentColor",
        vehicle.signalStatus === "stale"
          ? "opacity:.65"
          : "opacity:1",
      ].join(";");

      element.appendChild(chip);

      element.addEventListener(
        "click",
        () => {
          onSelect(vehicle.id);
        }
      );

      const marker =
        new handle.tt.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat([
            reading.lng,
            reading.lat,
          ])
          .addTo(handle.map);

      markersRef.current.push(marker);
    }

    if (mapped.length === 0) {
      handle.map.setCenter(DEFAULT_CENTER);
      handle.map.setZoom(DEFAULT_ZOOM);
      return;
    }

    if (mapped.length === 1) {
      const reading = mapped[0].reading;

      if (reading) {
        handle.map.easeTo({
          center: [
            reading.lng,
            reading.lat,
          ],
          zoom: 12,
        });
      }

      return;
    }

    const lngs = mapped.map(
      (vehicle) =>
        vehicle.reading!.lng
    );

    const lats = mapped.map(
      (vehicle) =>
        vehicle.reading!.lat
    );

    handle.map.fitBounds(
      [
        [
          Math.min(...lngs),
          Math.min(...lats),
        ],
        [
          Math.max(...lngs),
          Math.max(...lats),
        ],
      ],
      {
        padding: 60,
        maxZoom: 13,
      }
    );
  }, [
    vehicles,
    selectedVehicleId,
    onSelect,
    ready,
  ]);

  if (!MAP_KEY) {
    return (
      <div className="flex h-[460px] items-center justify-center rounded-lg border border-line bg-surface-2 px-6 text-center text-sm text-ink-3">
        Fleet map unavailable because no TomTom map key is configured.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <div
        ref={containerRef}
        className="h-[460px] w-full"
        aria-label="Fleet vehicle map"
      />

      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/70 text-sm text-ink-3">
          Loading fleet map?
        </div>
      ) : null}
    </div>
  );
}
