import type { TextareaHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/* Sibling of Field for multi-line input. Same AA wiring and the same .ds
   dependency: renders correctly only inside a `.ds` wrapper, because Preflight
   is disabled and the scoped reset supplies box-sizing and font inheritance. */

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Classes for the wrapping <div>, e.g. "sm:col-span-2". `className` targets the <textarea>. */
  wrapperClassName?: string;
  /** Renders the label as an uppercase Console kicker instead of body text. */
  kickerLabel?: boolean;
};

export default function Textarea({
  id,
  label,
  hint,
  error,
  className,
  wrapperClassName,
  kickerLabel,
  ...props
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", wrapperClassName)}>
      <label
        htmlFor={id}
        className={
          kickerLabel
            ? "text-kicker uppercase text-ink-3"
            : "text-sm font-medium text-ink-2"
        }
      >
        {label}
      </label>
      <textarea
        id={id}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          // border-ink-3 for the same WCAG 1.4.11 reason as Field.
          "min-h-24 rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-3",
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
      {error ? (
        <p id={errorId} className="text-xs text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
