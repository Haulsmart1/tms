import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so this
   relies on the scoped reset in app/globals.css for box-sizing and font
   inheritance. Outside `.ds` the input reverts to content-box with a UA border. */

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Classes for the wrapping <div>, e.g. "sm:col-span-2". `className` targets the <input>. */
  wrapperClassName?: string;
};

export default function Field({
  id,
  label,
  hint,
  error,
  className,
  wrapperClassName,
  ...props
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", wrapperClassName)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          /* border-ink-3, not border-line-strong: #CBD5E1 measures 1.48:1 on
             white and fails WCAG 1.4.11 (needs 3:1). The border is the only
             thing identifying an empty input, and on the surface-2 form card
             the fill differentiation is 1.045:1. #64748B measures 4.76:1.
             placeholder likewise: ink-4 was 2.56:1, ink-3 is 4.76:1. */
          /* w-full min-w-0: the input is a grid item of the wrapper above, so it
             inherits min-width:auto, which resolves to an <input>'s intrinsic ~20
             character width (about 194px). In a wrapper narrower than that (the job
             form's w-40 City and w-32 Postcode) it refused to shrink and overflowed
             into the next field. min-w-0 removes that floor, w-full makes it fill
             the wrapper. */
          "h-10 w-full min-w-0 rounded-md border bg-surface px-3 text-base text-ink placeholder:text-ink-3",
          error ? "border-danger" : "border-ink-3",
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
      {/* Plain <p>, NOT role="alert". A form that sets six field errors in one
          render would mount six assertive live regions that interrupt each
          other and drown out all but the last. The text is still announced via
          aria-describedby when focus reaches the input, and the form owns a
          single form-level role="alert" summary. */}
      {error ? (
        <p id={errorId} className="text-xs text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
