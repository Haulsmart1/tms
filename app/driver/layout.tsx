import type { ReactNode } from "react";

import DriverGpsTracker from "./DriverGpsTracker";

export default function DriverLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <>
      <DriverGpsTracker />
      {children}
    </>
  );
}
