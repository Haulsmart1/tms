"use client";
/*
  The driver's shift as the phone should show it: the last server state
  (GET /api/driver/shift) with every event the server has not reflected yet
  applied on top (lib/shifts/projection.ts), so the app answers instantly
  with no signal.
*/

import { loadDriverData, snapshotMessage, useDriverIdentity } from "./driverIdentity";
import { unreflectedEvents } from "../../lib/offline/driverCache";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pendingEvents } from "../../lib/offline/driverSync";
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
  /** Items another driver queued on this phone, held until they sign in. */
  heldForOthers: number;
  rejected: RejectedItem[];
  /** Set when sending has paused because the session has gone. */
  paused: string | null;
  /** The phone cannot store queued items (IndexedDB refused): keep the page open. */
  memoryOnly: boolean;
  reload: () => Promise<void>;
  /** Queue an event. The caller sets clientId (crypto.randomUUID()) and occurredAt. */
  submit: (event: DriverEvent) => Promise<void>;
  submitPhoto: (defectClientId: string, blob: Blob, mimeType: string, filename: string) => Promise<void>;
  dismissRejected: (id: string) => void;
};

const RELOAD_AFTER_SEND_MS = 600;

export function useDriverShift(): DriverShift {
  const owner = useDriverIdentity();
  const queue = useSyncExternalStore(subscribe, getQueueSnapshot, getServerQueueSnapshot);
  const [server, setServer] = useState<{ state: DriverShiftState; requestedAt: number; reflectedEventIds?: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++loadSeq.current;
    const requestedAt = Date.now();
    if (!owner) { setLoading(false); return; }
    try {
      const result = await loadDriverData<DriverShiftState>(owner, "/api/driver/shift");
      if (mine !== loadSeq.current) return;
      setForbidden(false);
      setServer({ state: result.data, requestedAt: result.cached ? result.reflectedAt ?? result.savedAt : requestedAt,
        reflectedEventIds: result.reflectedEventIds });
      setError(snapshotMessage(result) || null);
    } catch (error) {
      if (mine === loadSeq.current && (error as { status?: number }).status) {
        setServer(null);
        setForbidden((error as { status?: number }).status === 403);
      }
      if (mine === loadSeq.current) setError((error as { status?: number }).status === 403 ? null : error instanceof Error ? error.message : "Unable to load your shift.");
    } finally {
      if (mine === loadSeq.current) setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    setServer(null);
    setForbidden(false);
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => { ++loadSeq.current; window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); };
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
    return projectDriverState(server.state, unreflectedEvents([...accepted, ...pendingEvents(queue.pending)], server.reflectedEventIds));
  }, [server, queue]);

  return {
    state,
    loading,
    forbidden,
    error,
    pendingCount: queue.pending.length,
    heldForOthers: queue.heldForOthers,
    rejected: queue.rejected,
    paused: queue.paused,
    memoryOnly: queue.memoryOnly,
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
