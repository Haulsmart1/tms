import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Field. The class
   list matches Field's input classes so mixed forms align; see Field.tsx
   for the border-ink-3 contrast rationale. */

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Classes for the wrapping <div>, e.g. "sm:col-span-2". `className` targets the <select>. */
  wrapperClassName?: string;
  /** Renders the label as an uppercase Console kicker instead of body text. */
  kickerLabel?: boolean;
  children: ReactNode;
};

export default function Select({
  id,
  label,
  hint,
  error,
  className,
  wrapperClassName,
  kickerLabel,
  children,
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
      <select
        id={id}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border bg-surface px-3 text-base text-ink",
          error ? "border-danger" : "border-ink-3",
          className,
        )}
        {...props}
      >
        {children}
      </select>
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
