import type { Metadata } from "next";
import LoginForm from "../../login/LoginForm";

export const metadata: Metadata = {
  title: "Sign in to TMS Warehouse",
  manifest: "/warehouse/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TMS Warehouse" },
};

export default function WarehouseLoginPage() {
  return <LoginForm installedApp="warehouse" />;
}
