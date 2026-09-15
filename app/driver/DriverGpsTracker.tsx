"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  classifyLocationFailure,
  enqueuePosition,
  nextBackoffMs,
} from "../../lib/driver/gpsRetry";
import { metresPerSecondToKph } from "../../lib/driver/location";

const MIN_SEND_INTERVAL_MS = 15_000;

type TrackingState =
  | "idle"
  | "requesting"
  | "active"
  | "reconnecting"
  | "error";

type PositionPayload = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
};

function toPayload(position: GeolocationPosition): PositionPayload {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : null,
    speedKph: metresPerSecondToKph(position.coords.speed),
    heading:
      position.coords.heading !== null &&
      Number.isFinite(position.coords.heading)
        ? position.coords.heading
        : null,
    recordedAt: new Date(position.timestamp).toISOString(),
  };
}

/*
  Driver GPS tracking (review POD-16). A failed send no longer ends tracking:
  positions are queued (bounded) and retried with backoff, and flushed as soon
  as the browser reports it is back online. Tracking only stops on answers a
  retry cannot fix (signed out, forbidden, no usable vehicle assignment) or
  when location permission is denied.
*/
export default function DriverGpsTracker() {
  const [state, setState] = useState<TrackingState>("idle");
  const [message, setMessage] = useState("");
  const watchId = useRef<number | null>(null);
  const lastQueuedAt = useRef(0);
  const queue = useRef<PositionPayload[]>([]);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const sending = useRef(false);

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const endWatch = useCallback(() => {
    if (
      watchId.current !== null &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    watchId.current = null;
    lastQueuedAt.current = 0;
    queue.current = [];
    attempt.current = 0;
    clearRetry();
  }, [clearRetry]);

  const stopTracking = useCallback(() => {
    endWatch();
    setState("idle");
    setMessage("");
  }, [endWatch]);

  const flush = useCallback(async () => {
    if (sending.current || watchId.current === null) {
      return;
    }

    sending.current = true;

    try {
      while (queue.current.length > 0 && watchId.current !== null) {
        const item = queue.current[0];
        let status: number | null = null;
        let errorText = "";

        try {
          const response = await fetch("/api/driver/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });

          status = response.status;

          if (response.ok) {
            queue.current = queue.current.slice(1);
            attempt.current = 0;
            setState("active");
            setMessage("GPS tracking active");
            continue;
          }

          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          errorText = body.error ?? "";
        } catch {
          status = null;
        }

        const action = classifyLocationFailure(status);

        if (action === "drop") {
          queue.current = queue.current.slice(1);
          continue;
        }

        if (action === "stop") {
          endWatch();
          setState("error");
          setMessage(errorText || "GPS tracking stopped.");
          return;
        }

        setState("reconnecting");
        setMessage(
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "No signal. Positions are saved and will send when the signal returns."
            : "Connection problem. Retrying shortly...",
        );

        if (retryTimer.current === null) {
          const delay = nextBackoffMs(attempt.current);
          attempt.current += 1;
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            void flush();
          }, delay);
        }

        return;
      }
    } finally {
      sending.current = false;
    }
  }, [endWatch]);

  useEffect(() => {
    const handleOnline = () => {
      clearRetry();
      attempt.current = 0;
      void flush();
    };

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
      clearRetry();

      if (watchId.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [clearRetry, flush]);

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
      const now = Date.now();

      if (
        lastQueuedAt.current !== 0 &&
        now - lastQueuedAt.current < MIN_SEND_INTERVAL_MS
      ) {
        return;
      }

      lastQueuedAt.current = now;
      queue.current = enqueuePosition(queue.current, toPayload(position));

      if (retryTimer.current === null) {
        void flush();
      }
    },
    [flush],
  );

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setState("error");
      setMessage("GPS location is not supported by this browser.");
      return;
    }

    if (watchId.current !== null) {
      return;
    }

    setState("requesting");
    setMessage("Requesting GPS permission...");

    watchId.current = navigator.geolocation.watchPosition(
      handlePosition,
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          endWatch();
          setState("error");
          setMessage(
            "Location permission was denied. Enable location access for this site.",
          );
          return;
        }

        // Unavailable or timed out: the watch keeps running and recovers by itself.
        setMessage(
          error.code === error.TIMEOUT
            ? "Waiting for a GPS fix..."
            : "GPS position is currently unavailable. Still trying...",
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      },
    );
  }, [endWatch, handlePosition]);

  const active =
    state === "active" || state === "requesting" || state === "reconnecting";

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
            : state === "reconnecting"
              ? "GPS Reconnecting"
              : "Driver GPS"}
        </strong>
        {message ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color:
                state === "error"
                  ? "#b42318"
                  : state === "reconnecting"
                    ? "#b54708"
                    : "#667085",
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
