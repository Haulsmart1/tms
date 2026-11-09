import type { Metadata } from "next";
import WarehouseDashboard from "./WarehouseDashboard";

export const metadata: Metadata = { title: "Warehouse | TMS Wizard", robots: { index: false, follow: false } };
export default function WarehousePage() { return <WarehouseDashboard />; }
