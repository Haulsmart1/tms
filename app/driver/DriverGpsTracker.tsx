"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  classifyLocationFailure,
  GPS_QUEUE_MAX,
  nextBackoffMs,
} from "../../lib/driver/gpsRetry";
import { metresPerSecondToKph } from "../../lib/driver/location";
import { createClient } from "../../lib/supabase/browser";

const MIN_SEND_INTERVAL_MS = 15_000;
const GPS_TRACKING_OPT_IN_KEY = "tms.driver.gps-tracking.v1";

function hasTrackingOptIn(): boolean {
  try {
    return window.localStorage.getItem(GPS_TRACKING_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

function setTrackingOptIn(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(GPS_TRACKING_OPT_IN_KEY, "1");
    } else {
      window.localStorage.removeItem(GPS_TRACKING_OPT_IN_KEY);
    }
  } catch {
    // Tracking still works when browser storage is unavailable.
  }
}

type TrackingState =
  | "idle"
  | "requesting"
  | "active"
  | "reconnecting"
  | "error";

type PositionPayload = {
  /** Older unbound points are held; never assign them the current user. */
  ownerId?: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
};

function toPayload(position: GeolocationPosition, ownerId: string): PositionPayload {
  return {
    ownerId,
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
  const trackingOwner = useRef<string | null>(null);
  const starting = useRef(false);
  const observedOwner = useRef<string | null | undefined>(undefined);
  const watchGeneration = useRef(0);
  const mounted = useRef(true);

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
    watchGeneration.current += 1;
    lastQueuedAt.current = 0;
    // Stopping or changing accounts must not discard unsent GPS records.
    // They remain owner-bound in this tab until their owner returns.
    trackingOwner.current = null;
    attempt.current = 0;
    clearRetry();
  }, [clearRetry]);

  const stopTracking = useCallback(() => {
    setTrackingOptIn(false);
    endWatch();
    setState("idle");
    setMessage(queue.current.length ? "GPS stopped. Unsent positions remain in this tab; keep it open." : "");
  }, [endWatch]);

  const flush = useCallback(async () => {
    if (sending.current || watchId.current === null) {
      return;
    }

    sending.current = true;

    try {
      while (queue.current.length > 0 && watchId.current !== null) {
        const item = queue.current.find(point => point.ownerId && point.ownerId === trackingOwner.current);
        if (!item) {
          setMessage("Unsent GPS positions are held for their original sign-in. Keep this tab open and tell the office.");
          return;
        }
        const generation = watchGeneration.current;
        let status: number | null = null;
        let errorText = "";

        try {
          const { data, error } = await createClient().auth.getSession();
          // This read may have started under A, then settle after B starts a
          // new watch. The obsolete read must not stop B's watch.
          if (!mounted.current || watchId.current === null || trackingOwner.current !== item.ownerId || watchGeneration.current !== generation) return;
          if (error) throw error;
          if (data.session?.user.id !== item.ownerId) {
            setTrackingOptIn(false);
            endWatch();
            setState("error");
            setMessage("Sign-in changed. Unsent GPS positions are held in this tab for their original driver.");
            return;
          }
          const response = await fetch("/api/driver/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });

          status = response.status;

          if (response.ok) {
            queue.current = queue.current.filter(point => point !== item);
            if (watchGeneration.current !== generation || !mounted.current) return;
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

        // A pending request may settle after an account switch or unmount.
        // Its failed answer must not revive retries or status on a stopped watch.
        if (watchId.current === null || !mounted.current || watchGeneration.current !== generation) return;

        const action = classifyLocationFailure(status);

        if (action === "drop") {
          // Even rejected fixes may be needed to reconcile a journey.
          endWatch();
          setState("error");
          setMessage("A GPS position was refused and remains in this tab. Keep it open and tell the office.");
          return;
        }

        if (action === "stop") {
          setTrackingOptIn(false);
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
    mounted.current = true;
    const handleOnline = () => {
      clearRetry();
      attempt.current = 0;
      void flush();
    };

    window.addEventListener("online", handleOnline);
    const warnUnsent = (event: BeforeUnloadEvent) => {
      if (queue.current.length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsent);

    return () => {
      mounted.current = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("beforeunload", warnUnsent);
      clearRetry();

      if (watchId.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      watchId.current = null;
      watchGeneration.current += 1;
    };
  }, [clearRetry, flush]);

  useEffect(() => {
    try {
      const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
        observedOwner.current = session?.user.id ?? null;
        if (!trackingOwner.current || session?.user.id === trackingOwner.current) return;
        setTrackingOptIn(false);
        endWatch();
        setState("idle");
        setMessage(queue.current.length ? "Sign-in changed. Unsent GPS positions remain in this tab for their original driver." : "Sign in and start GPS tracking again.");
      });
      return () => subscription.unsubscribe();
    } catch {
      endWatch();
      setState("error");
      setMessage("GPS account access is unavailable. Unsent positions remain in this tab.");
    }
  }, [endWatch]);

  const handlePosition = useCallback(
    (position: GeolocationPosition, ownerId: string, generation: number) => {
      // Queued callbacks from an old watch must never acquire a new driver's
      // identity after that driver starts a fresh watch on the same page.
      if (!mounted.current || watchGeneration.current !== generation || trackingOwner.current !== ownerId || watchId.current === null) return;
      const now = Date.now();

      if (
        lastQueuedAt.current !== 0 &&
        now - lastQueuedAt.current < MIN_SEND_INTERVAL_MS
      ) {
        return;
      }

      if (!trackingOwner.current || watchId.current === null) return;
      if (queue.current.length >= GPS_QUEUE_MAX) {
        endWatch();
        setState("error");
        setMessage("GPS storage in this tab is full. All unsent positions are held; keep this tab open and reconnect before restarting.");
        return;
      }
      lastQueuedAt.current = now;
      queue.current = [...queue.current, toPayload(position, ownerId)];

      if (retryTimer.current === null) {
        void flush();
      }
    },
    [endWatch, flush],
  );

  const startTracking = useCallback(async (rememberOptIn = true) => {
    if (!navigator.geolocation) {
      setState("error");
      setMessage("GPS location is not supported by this browser.");
      return;
    }

    if (watchId.current !== null || starting.current) {
      return;
    }

    starting.current = true;
    try {
      const { data, error } = await createClient().auth.getSession();
      if (!mounted.current || (observedOwner.current !== undefined && observedOwner.current !== (data.session?.user.id ?? null))) return;
      if (error || !data.session?.user.id) {
        setState("error");
        setMessage("Connect and sign in before starting GPS tracking. Unsent positions remain in this tab.");
        return;
      }
      trackingOwner.current = data.session.user.id;
    } catch {
      setState("error");
      setMessage("Connect and sign in before starting GPS tracking. Unsent positions remain in this tab.");
      return;
    } finally { starting.current = false; }

    if (rememberOptIn) {
      setTrackingOptIn(true);
    }

    setState("requesting");
    setMessage("Requesting GPS permission...");

    const ownerId = trackingOwner.current!;
    const generation = ++watchGeneration.current;
    watchId.current = navigator.geolocation.watchPosition(
      position => handlePosition(position, ownerId, generation),
      (error) => {
        if (!mounted.current || watchGeneration.current !== generation || trackingOwner.current !== ownerId) return;
        if (error.code === error.PERMISSION_DENIED) {
          setTrackingOptIn(false);
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
    void flush();
  }, [endWatch, flush, handlePosition]);

  useEffect(() => {
    if (hasTrackingOptIn()) {
      startTracking(false);
    }
  }, [startTracking]);

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
        onClick={active ? stopTracking : () => startTracking()}
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
