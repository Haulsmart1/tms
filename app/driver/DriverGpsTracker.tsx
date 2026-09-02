"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { metresPerSecondToKph } from "../../lib/driver/location";

const MIN_SEND_INTERVAL_MS = 15_000;

type TrackingState =
  | "idle"
  | "requesting"
  | "active"
  | "error";

export default function DriverGpsTracker() {
  const [state, setState] = useState<TrackingState>("idle");
  const [message, setMessage] = useState("");
  const watchId = useRef<number | null>(null);
  const lastSentAt = useRef(0);

  const stopTracking = useCallback(() => {
    if (
      watchId.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    watchId.current = null;
    lastSentAt.current = 0;
    setState("idle");
    setMessage("");
  }, []);

  useEffect(() => {
    return () => {
      if (
        watchId.current !== null &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  const sendPosition = useCallback(
    async (position: GeolocationPosition) => {
      const now = Date.now();

      if (
        lastSentAt.current !== 0 &&
        now - lastSentAt.current < MIN_SEND_INTERVAL_MS
      ) {
        return;
      }

      lastSentAt.current = now;

      try {
        const response = await fetch("/api/driver/location", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
            speedKph: metresPerSecondToKph(
              position.coords.speed,
            ),
            heading:
              position.coords.heading !== null &&
              Number.isFinite(position.coords.heading)
                ? position.coords.heading
                : null,
            recordedAt: new Date(
              position.timestamp,
            ).toISOString(),
          }),
        });

        const body = (await response.json()) as {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            body.error || "Unable to send GPS position.",
          );
        }

        setState("active");
        setMessage("GPS tracking active");
      } catch (error) {
        if (watchId.current !== null) {
          navigator.geolocation.clearWatch(watchId.current);
        }

        watchId.current = null;
        lastSentAt.current = 0;
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to send GPS position.",
        );
      }
    },
    [],
  );

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setState("error");
      setMessage(
        "GPS location is not supported by this browser.",
      );
      return;
    }

    if (watchId.current !== null) {
      return;
    }

    setState("requesting");
    setMessage("Requesting GPS permission...");

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        void sendPosition(position);
      },
      (error) => {
        watchId.current = null;
        setState("error");

        if (error.code === error.PERMISSION_DENIED) {
          setMessage(
            "Location permission was denied. Enable location access for this site.",
          );
          return;
        }

        if (error.code === error.POSITION_UNAVAILABLE) {
          setMessage("GPS position is currently unavailable.");
          return;
        }

        if (error.code === error.TIMEOUT) {
          setMessage("GPS request timed out. Please try again.");
          return;
        }

        setMessage("Unable to obtain GPS position.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      },
    );
  }, [sendPosition]);

  const active =
    state === "active" || state === "requesting";

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid #d7dce2",
        background: "#ffffff",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div>
        <strong>
          {state === "active"
            ? "GPS Tracking Active"
            : "Driver GPS"}
        </strong>
        {message ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: state === "error" ? "#b42318" : "#667085",
            }}
          >
            {message}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={active ? stopTracking : startTracking}
        style={{
          minHeight: 42,
          padding: "8px 14px",
          border: "1px solid #c8ced6",
          borderRadius: 8,
          background: active ? "#fff" : "#111827",
          color: active ? "#111827" : "#fff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {active ? "Stop Tracking" : "Start GPS Tracking"}
      </button>
    </div>
  );
}
