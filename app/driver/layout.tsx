import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import DriverPwa from "./DriverPwa";
import DriverSessionBoundary from "./DriverSessionBoundary";

import DriverGpsTracker from "./DriverGpsTracker";

export const metadata: Metadata = {
  title: "TMS Wizard Driver",
  manifest: "/driver/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TMS Driver", statusBarStyle: "black-translucent" },
  icons: { apple: "/driver/icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F1626" };

export default function DriverLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <>
      <DriverPwa />
      <DriverGpsTracker />
      <DriverSessionBoundary>{children}</DriverSessionBoundary>
    </>
  );
}
