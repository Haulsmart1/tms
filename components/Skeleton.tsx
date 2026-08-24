import { cn } from "../lib/cn";

type Props = {
  /** Any CSS width. Inline, not a class, because cn() composes rather than overrides. */
  w?: string;
  /** Any CSS height. Inline, for the same reason. */
  h?: string;
  rounded?: "sm" | "full";
  /* "inline" preserves the parent's line box, so a skeleton standing in for
     text does not collapse the line height and shift the layout underneath it.
     "block" is right for a bar that owns its own row, such as a table cell. */
  display?: "block" | "inline";
  className?: string;
};

/* Every skeleton is aria-hidden. The announcement for a loading region is one
   visually hidden role="status" line on the region itself, not one per bar:
   a screen reader reading out forty grey rectangles is worse than silence. */
export default function Skeleton({
  w = "100%",
  h = "0.75rem",
  rounded = "sm",
  display = "block",
  className,
}: Props) {
  return (
    <span
      aria-hidden
      style={{ width: w, height: h }}
      className={cn(
        // ds-pulse, not Tailwind's animate-pulse: it is the only one of the two
        // with a prefers-reduced-motion guard (app/globals.css:76-80). It is
        // scoped as `.ds .ds-pulse`, so this is inert on legacy pages by
        // construction rather than by discipline.
        "ds-pulse bg-skeleton",
        display === "inline" ? "inline-block align-middle" : "block",
        rounded === "full" ? "rounded-full" : "rounded",
        className,
      )}
    />
  );
}
