/*
  Design-token classes for the shift panel on the driver dashboard. The page
  is themeable (lib/nav/themeableRoutes.ts), so nothing here may use raw
  colours or `dark:` variants. Buttons are at least 44px tall for gloved use.
*/

export const ui = {
  card: "mb-5 rounded-lg border border-line bg-surface p-5 shadow-sm",
  title: "m-0 text-md font-semibold text-ink",
  subTitle: "m-0 text-sm font-semibold text-ink",
  body: "m-0 text-sm text-ink",
  label: "block text-kicker uppercase text-ink-2",
  muted: "m-0 text-xs text-ink-2",
  input: "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink",
  textarea: "min-h-24 w-full rounded-md border border-line bg-surface p-3 text-base text-ink",
  primary:
    "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-on-primary no-underline hover:bg-primary-hover disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink no-underline disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center rounded-md bg-danger px-4 text-sm font-semibold text-on-danger no-underline disabled:opacity-50",
  error: "m-0 rounded-md border border-danger-border bg-danger-tint p-3 text-sm font-semibold text-danger-strong",
  dangerNote: "m-0 rounded-md border border-danger-border bg-danger-tint p-3 text-sm text-danger-strong",
  dangerBadge:
    "ml-2 inline-block rounded-full border border-danger-border bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger-strong",
  warningBadge:
    "inline-block rounded-full border border-warning-border bg-warning-tint px-2 py-0.5 text-[11px] font-semibold text-warning-strong",
  successBadge:
    "inline-block rounded-full border border-success-border bg-success-tint px-2 py-0.5 text-[11px] font-semibold text-success-strong",
} as const;
