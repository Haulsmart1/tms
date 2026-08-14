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
        "rounded-lg border border-line bg-surface shadow-sm",
        flush ? "overflow-hidden" : "p-4",
        className,
      )}
    >
      {kicker ? (
        <div className="mb-2 text-kicker uppercase text-ink-3">{kicker}</div>
      ) : null}
      {children}
    </div>
  );
}
