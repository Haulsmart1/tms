import type { Metadata, Viewport } from "next";
import WarehouseDashboard from "./WarehouseDashboard";

export const metadata: Metadata = {
  title: "Warehouse | TMS Wizard",
  robots: { index: false, follow: false },
  manifest: "/warehouse/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TMS Warehouse", statusBarStyle: "default" },
  icons: { apple: "/driver/icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F1626" };
export default function WarehousePage() { return <WarehouseDashboard />; }
