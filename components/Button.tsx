import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so this
   relies on the scoped reset in app/globals.css for appearance:none,
   border-width:0 and font inheritance. Outside `.ds` it silently falls back to
   UA button styling. */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  // text-on-primary / text-on-danger, not text-white: under the dark default
  // --primary is a light blue and white on it measures 2.54:1, an AA failure on
  // the most-clicked control in the app. The token is #FFFFFF in light and dark
  // ink in dark, so both themes are correct with no per-theme class.
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-hover",
  ghost: "bg-transparent text-ink hover:bg-surface-hover",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 h-9",
  md: "text-base px-4 h-10",
  lg: "text-base px-5 h-11",
};

/**
 * The button look as a bare class string, for `<a>` / `<Link>` elements.
 * Nesting a real <button> inside an anchor is invalid HTML and produces a
 * double stop in the accessibility tree, so links that should look like
 * buttons use this instead of wrapping <Button>.
 */
export function buttonClasses(
  variant: Variant = "primary",
  size: Size = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  // The HTML default is "submit". Defaulting to "button" stops a secondary
  // action added inside a <form> later from silently submitting it.
  type = "button",
  disabled,
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={cn(buttonClasses(variant, size), loading ? "cursor-wait" : undefined, className)}
      /* Deliberately NOT disabled while loading. Disabling the focused button
         drops focus to <body>, so a keyboard or screen-reader user loses their
         place and never hears aria-busy. Consumers guard double submission in
         their own submit handler (`if (loading) return`). `disabled` still
         works for genuinely inactive buttons. */
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* children are kept during loading: swapping in "Please wait..." threw
          away the label and shrank the button ~14px mid-submit. */}
      {children}
    </button>
  );
}
