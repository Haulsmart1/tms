"use client";
import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { useDriverIdentity } from "./driverIdentity";
import { getQueueSnapshot, getServerQueueSnapshot, subscribe } from "./driverQueue";

/** Remount all driver forms when a shared phone changes accounts. */
export default function DriverSessionBoundary({ children }: { children: ReactNode }) {
  const owner = useDriverIdentity();
  const queue = useSyncExternalStore(subscribe, getQueueSnapshot, getServerQueueSnapshot);
  const volatileHeldItems = queue.memoryOnly && queue.heldForOthers > 0;
  return <>
    {volatileHeldItems ? (
      <p role="alert" className="m-3 rounded-md border border-danger-border bg-danger-tint p-3 text-sm font-semibold text-danger-strong">
        This phone has unsent items that it cannot store. Keep this tab open. Tell the office before closing or refreshing it. To sign in again, use a separate tab and return here afterwards.
      </p>
    ) : null}
    {!owner
      ? <main className="ds bg-canvas p-6 font-sans text-ink"><p>Connect and sign in to load your driver app.</p><a href="/login?next=/driver/dashboard" target={volatileHeldItems ? "_blank" : undefined} rel={volatileHeldItems ? "noopener" : undefined}>{volatileHeldItems ? "Sign in in another tab" : "Sign in"}</a></main>
      : <Fragment key={owner}>{children}</Fragment>}
  </>;
}
