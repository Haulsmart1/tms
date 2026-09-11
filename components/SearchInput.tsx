"use client";

import { Search, X } from "lucide-react";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so this
   relies on the scoped reset in app/globals.css for box-sizing and font
   inheritance, exactly as components/Field.tsx does. The input classes are kept
   in step with Field's on purpose: two differently-styled text inputs in one
   console is the kind of drift nobody notices until a screenshot. */

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown beside the box, e.g. "3 of 24". */
  resultHint?: string;
};

export default function SearchInput({
  id,
  label,
  value,
  onChange,
  placeholder = "Search",
  resultHint,
}: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>

        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
        >
          <Search size={16} />
        </span>

        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface pl-9 pr-9 text-base text-ink placeholder:text-ink-3"
        />

        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-3 hover:bg-surface-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {resultHint ? (
        <span role="status" className="text-xs text-ink-3">
          {resultHint}
        </span>
      ) : null}
    </div>
  );
}
