"use client";
/*
  The driver's shift as the phone should show it: the last server state
  (GET /api/driver/shift) with every event the server has not reflected yet
  applied on top (lib/shifts/projection.ts), so the app answers instantly
  with no signal.
*/

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pendingEvents } from "../../lib/offline/driverSync";
import { errorFromBody, readJsonSafe } from "../../lib/pod/uploadClient";
import type { DriverEvent } from "../../lib/shifts/events";
import { projectDriverState } from "../../lib/shifts/projection";
import type { DriverShiftState } from "../../lib/walkaround/driverState";
import {
  dismissRejected,
  enqueueEvent,
  enqueuePhoto,
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribe,
  type RejectedItem,
} from "./driverQueue";

export type DriverShift = {
  /** Projected state; null until the first successful load. */
  state: DriverShiftState | null;
  loading: boolean;
  /** The server said shifts are not for this driver (a subcontractor): hide shift UI, do not gate jobs. */
  forbidden: boolean;
  /** The last load failed. `state` keeps the previous value when there was one. */
  error: string | null;
  pendingCount: number;
  rejected: RejectedItem[];
  /** Set when sending has paused because the session has gone. */
  paused: string | null;
  reload: () => Promise<void>;
  /** Queue an event. The caller sets clientId (crypto.randomUUID()) and occurredAt. */
  submit: (event: DriverEvent) => Promise<void>;
  submitPhoto: (defectClientId: string, blob: Blob, mimeType: string, filename: string) => Promise<void>;
  dismissRejected: (id: string) => void;
};

const RELOAD_AFTER_SEND_MS = 600;

export function useDriverShift(): DriverShift {
  const queue = useSyncExternalStore(subscribe, getQueueSnapshot, getServerQueueSnapshot);
  const [server, setServer] = useState<{ state: DriverShiftState; requestedAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++loadSeq.current;
    const requestedAt = Date.now();
    try {
      const response = await fetch("/api/driver/shift", { cache: "no-store" });
      const body = await readJsonSafe(response);
      if (mine !== loadSeq.current) return;
      if (response.status === 403) {
        setForbidden(true);
        setError(null);
      } else if (!response.ok) {
        setError(errorFromBody(body, response.status, "Unable to load your shift."));
      } else {
        setForbidden(false);
        setServer({ state: body as unknown as DriverShiftState, requestedAt });
        setError(null);
      }
    } catch {
      if (mine === loadSeq.current) setError("No connection. Showing what this phone already knows.");
    } finally {
      if (mine === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Re-read the server once events have been accepted (debounced, so a burst
  // of sends costs one request).
  const sentCount = queue.sent.length;
  useEffect(() => {
    if (sentCount === 0) return;
    const timer = setTimeout(() => void reload(), RELOAD_AFTER_SEND_MS);
    return () => clearTimeout(timer);
  }, [sentCount, reload]);

  const state = useMemo(() => {
    if (!server) return null;
    // Events accepted after that server read began are not in it yet; keep
    // showing them, then everything still queued.
    const accepted = queue.sent.filter((s) => s.sentAt >= server.requestedAt).map((s) => s.event);
    return projectDriverState(server.state, [...accepted, ...pendingEvents(queue.pending)]);
  }, [server, queue]);

  return {
    state,
    loading,
    forbidden,
    error,
    pendingCount: queue.pending.length,
    rejected: queue.rejected,
    paused: queue.paused,
    reload,
    submit: enqueueEvent,
    submitPhoto: enqueuePhoto,
    dismissRejected,
  };
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** navigator.onLine as React state (true during server rendering). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
