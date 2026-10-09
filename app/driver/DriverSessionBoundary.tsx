"use client";
import { Fragment, type ReactNode } from "react";
import { useDriverIdentity } from "./driverIdentity";

/** Remount all driver forms when a shared phone changes accounts. */
export default function DriverSessionBoundary({ children }: { children: ReactNode }) {
  const owner = useDriverIdentity();
  if (!owner) return <main className="ds bg-canvas p-6 font-sans text-ink"><p>Connect and sign in to load your driver app.</p><a href="/login?next=/driver/dashboard">Sign in</a></main>;
  return <Fragment key={owner}>{children}</Fragment>;
}
