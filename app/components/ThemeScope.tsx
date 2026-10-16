"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isThemeableRoute } from "../../lib/nav/themeableRoutes";
import { useTenant } from "./TenantProvider";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";

/* Pins every non-themeable route dark by putting `.dark` on the content
   wrapper, which re-declares the dark token values for that subtree and so
   overrides an ancestor `.light` on <html>.

   Needed because the ~14 legacy pages are styled with hardcoded inline colour
   literals. They cannot follow a theme, so if the tokens around them went light
   their dark-tuned content would break: /tracking puts white cards and white
   headings on the page background and would render white-on-white.

   Deleting this component is the final step of the design-system rollout, once
   every route is in THEMEABLE_ROUTES. */
export default function ThemeScope({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status } = useTenant();
  const pinned = !isThemeableRoute(pathname);
  const hasShell = shouldShowShell(pathname, status);

  return (
    <div className={`tms-content min-w-0 flex-1${pinned ? " dark" : ""}${hasShell ? " tms-has-shell" : ""}`}>
      {children}
    </div>
  );
}
