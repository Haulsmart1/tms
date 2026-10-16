import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   border here depends on the scoped reset in app/globals.css supplying
   border-style: solid. Outside `.ds` the border disappears entirely. */

type Props = {
  children: ReactNode;
  /** Section label rendered as an uppercase kicker above the content. */
  kicker?: string;
  className?: string;
  /** Removes padding, for cards whose child manages its own (a table). */
  flush?: boolean;
};

export default function Card({ children, kicker, className, flush }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl border border-card bg-surface shadow-sm",
        flush ? "overflow-hidden" : "p-4",
        className,
      )}
    >
      {kicker ? (
        <div className="mb-3 flex items-center gap-2 text-kicker uppercase tracking-[0.08em] text-primary">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {kicker}
        </div>
      ) : null}
      {children}
    </div>
  );
}
