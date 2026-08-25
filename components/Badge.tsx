import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   border here depends on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the border disappears entirely. */

export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const tones: Record<Tone, string> = {
  info: "bg-primary-tint text-primary-deep border-primary-tint-border",
  success: "bg-success-tint text-success-strong border-success-border",
  warning: "bg-warning-tint text-warning-strong border-warning-border",
  danger: "bg-danger-tint text-danger-strong border-danger-border",
  neutral: "bg-surface-2 text-ink-2 border-line",
};

export default function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
