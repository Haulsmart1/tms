/*
  Fixed light palette for the walkaround check screens, copied from
  /driver/jobs/[jobId]. These pages are deliberately NOT themeable (not in
  lib/nav/themeableRoutes.ts): a phone in a yard in daylight. Tap targets are
  at least 44px (min-h-11 / min-h-12) for gloved hands.
*/

export const w = {
  main: "min-h-screen bg-slate-100 px-3 py-4 text-slate-950 sm:px-5 sm:py-6",
  wrap: "mx-auto grid max-w-2xl gap-4",
  card: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
  kicker: "text-xs font-black uppercase tracking-wider text-blue-700",
  title: "m-0 mt-1 text-2xl font-black",
  h2: "m-0 text-lg font-black",
  body: "m-0 text-sm leading-6 text-slate-700",
  muted: "m-0 text-xs text-slate-500",
  label: "text-xs font-black uppercase tracking-wide text-slate-600",
  input: "mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600",
  textarea: "mt-1 min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none focus:border-blue-600",
  primary: "min-h-12 rounded-xl border-0 bg-blue-700 px-4 text-sm font-black text-white disabled:opacity-50",
  secondary: "min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800 disabled:opacity-50",
  link: "inline-flex min-h-12 items-center justify-center rounded-xl border-0 bg-blue-700 px-4 text-sm font-black text-white no-underline",
  back: "inline-flex min-h-11 items-center border-0 bg-transparent p-0 text-sm font-black text-blue-700 no-underline",
  error: "m-0 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800",
  warning: "m-0 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900",
  success: "m-0 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900",
  dangerBadge: "inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black uppercase text-red-800",
  minorBadge: "inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black uppercase text-amber-900",
  okOn: "min-h-12 rounded-xl border-2 border-emerald-700 bg-emerald-700 px-3 text-sm font-black text-white",
  okOff: "min-h-12 rounded-xl border-2 border-emerald-700 bg-white px-3 text-sm font-black text-emerald-800 disabled:opacity-40",
  defectOn: "min-h-12 rounded-xl border-2 border-red-700 bg-red-700 px-3 text-sm font-black text-white",
  defectOff: "min-h-12 rounded-xl border-2 border-red-700 bg-white px-3 text-sm font-black text-red-800",
  option: "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 bg-white px-4 text-left text-base font-bold",
  check: "flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-900",
} as const;
