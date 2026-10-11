"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { isPublicMarketingSurface } from "../../lib/seo/routes";
import { isLegalPath } from "../../lib/legal/routes";

const ApplicationFrame = dynamic(() => import("./ApplicationFrame"));

export default function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // No tenant lookup or operational sidebar bundle on marketing/policy pages.
  // Auth and customer token pages retain their existing application providers.
  if (isPublicMarketingSurface(pathname) || isLegalPath(pathname)) return <>{children}</>;
  return <ApplicationFrame>{children}</ApplicationFrame>;
}
