"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/cn";

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
  /** Classes for the wrapping <div>, e.g. spacing overrides. Follows Field's convention. */
  wrapperClassName?: string;
};

export default function SearchInput({
  id,
  label,
  value,
  onChange,
  placeholder = "Search",
  resultHint,
  wrapperClassName,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2", wrapperClassName)}>
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
          ref={inputRef}
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          /* [&::-webkit-search-cancel-button]:appearance-none suppresses Chromium/Safari's
             native ::-webkit-search-cancel-button, which type="search" renders whenever the
             field has a value and would otherwise sit about 14px from our own X, producing two
             clear icons. This is scoped to this input only. Do NOT hoist it into a global
             `input[type=search]::-webkit-search-cancel-button` rule in app/globals.css:
             app/pod/page.tsx:1078 and app/jobs/page.tsx:966 both use type="search" inputs
             whose ONLY clear affordance today is that native button, so a global rule would
             silently remove their one way to clear the field. */
          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface pl-9 pr-9 text-base text-ink placeholder:text-ink-3 [&::-webkit-search-cancel-button]:appearance-none"
        />

        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              // The button is conditionally rendered on `value`, so clicking it
              // unmounts the button itself and the browser drops focus to
              // <body>. Refocusing the input keeps a keyboard/screen-reader
              // user anchored where they were instead of bumping them to the
              // top of the document with no announcement.
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-3 hover:bg-surface-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {/* Rendered unconditionally (empty when there is no hint) so the live
          region exists in the DOM before it ever gains content. A region
          inserted at the same moment it gains text is what most screen
          readers fail to announce; inserted empty and then filled, the
          content change is announced normally. */}
      <span role="status" className="text-xs text-ink-3">
        {resultHint ?? ""}
      </span>
    </div>
  );
}
