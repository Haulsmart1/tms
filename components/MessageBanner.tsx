import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Card and Badge.

   Always render this component (never behind `{message ? ...}`): the
   sr-only empty state keeps the live region mounted, which is what makes
   screen readers announce a message when it later appears. */

export type BannerTone = "neutral" | "info" | "success" | "warning" | "danger";

const tones: Record<BannerTone, string> = {
  neutral: "border-line bg-surface text-ink-2",
  info: "border-primary-tint-border bg-primary-tint text-primary-deep",
  success: "border-success-border bg-success-tint text-success-strong",
  warning: "border-warning-border bg-warning-tint text-warning-strong",
  danger: "border-danger-border bg-danger-tint text-danger-strong",
};

export default function MessageBanner({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BannerTone;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        children
          ? cn("mb-4 rounded-lg border p-3 text-sm", tones[tone], className)
          : "sr-only"
      }
    >
      {children}
    </div>
  );
}
