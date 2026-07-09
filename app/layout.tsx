import type { Metadata } from "next";
import AppHeader from "./components/AppHeader";

export const metadata: Metadata = {
  title: "TMS Wizzard",
  description: "Transport Management System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0f172a",
          color: "#0f172a",
        }}
      >
        <AppHeader />
        {children}
      </body>
    </html>
  );
}