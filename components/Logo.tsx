import type { CSSProperties } from "react";

/* The finalized "Dispatch Arrow" mark from the Logo Concepts design project.
   Colors are fixed regardless of theme (blue tile + white glyph, or the naked
   glyph on its own) — this is deliberate per the logo project's own rationale,
   not a token oversight. */

type Props = {
  /** "tile": blue rounded-rect with a white glyph (nav/header use).
      "glyph": the mark alone, no container (inline in headings, empty states). */
  variant?: "tile" | "glyph";
  /** Only used by variant="glyph" — which color the naked glyph renders in. */
  theme?: "blue" | "white";
  size?: number;
  className?: string;
  /** When true, renders aria-hidden and omits role/aria-label (for use next to adjacent text). */
  decorative?: boolean;
};

export default function Logo({ variant = "tile", theme = "blue", size = 32, className, decorative = false }: Props) {
  const style: CSSProperties = { flexShrink: 0 };
  const a11yProps = decorative
    ? ({ "aria-hidden": true as const } as const)
    : ({ role: "img" as const, "aria-label": "TMS Wizzard" } as const);

  if (variant === "tile") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        style={style}
        className={className}
        {...a11yProps}
      >
        <rect width="48" height="48" rx="13" fill="#2953E3" />
        <circle cx="13" cy="35" r="5" fill="#FFFFFF" />
        <path
          d="M13 35 C 13 21.5, 21 13.5, 31 13.5"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <polygon points="29,6.5 41,13.5 29,20.5" fill="#FFFFFF" />
      </svg>
    );
  }

  const glyphColor = theme === "white" ? "#FFFFFF" : "#2953E3";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={style}
      className={className}
      {...a11yProps}
    >
      <circle cx="13" cy="35" r="5" fill={glyphColor} />
      <path
        d="M13 35 C 13 21.5, 21 13.5, 31 13.5"
        fill="none"
        stroke={glyphColor}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <polygon points="29,6.5 41,13.5 29,20.5" fill={glyphColor} />
    </svg>
  );
}
