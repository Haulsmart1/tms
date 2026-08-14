# AppShell has no mobile nav, so every console page scrolls sideways at 375px

**Found:** 2026-08-13, by `tests/pod-layout.spec.mjs` during the POD Console redesign.
**Affects:** every route that renders `AppShell`, which today is `/dashboard`, `/jobs` and `/pod`.
**Not caused by:** the POD redesign. `/pod` is the least bad of the three.
**Severity:** cosmetic on desktop, unusable on a phone. Decide whether phones are in scope at all.

## What happens

`app/components/AppShell.tsx` renders the sidebar as:

```
<aside className="ds sticky top-0 flex h-screen w-[220px] flex-none flex-col bg-chrome font-sans">
```

`w-[220px] flex-none` with no responsive collapse, so the sidebar keeps its full width at every
viewport. At 375px that leaves 155px for content, and `main`'s `px-6` cuts it to about 107px. The
three KPI tiles on `/pod` get roughly 30px each and burst out of their column.

## Measured

Same browser, same run, signed in, `document.scrollWidth` against a 375px viewport:

| Route | Sideways scroll | doc width | aside | main |
|---|---|---|---|---|
| `/dashboard` | YES | 886px | 220px | 155px |
| `/jobs` | YES | 442px | 220px | 155px |
| `/pod` | YES | 447px | 220px | 155px |

At 1280px, 900px and above, all three are clean at 220px aside and 1060px / 680px main. The problem
appears only once the viewport drops near the sidebar's own width.

`/dashboard` is the worst by a wide margin, which is the clearest evidence this is an `AppShell`
issue rather than anything to do with the POD queue.

## Why it was not fixed in the POD branch

Fixing it means designing a mobile navigation pattern, a drawer or a hamburger or a collapse-to-icons
rail, and that changes every route including the ones the boss looks at. That is a design decision
with its own review, not something to slip into a POD change.

## How the POD test treats it

`tests/pod-layout.spec.mjs` still measures 375px and still prints what it finds, but reports it as
`KNOWN` rather than `FAIL`, so the suite goes green on what the POD branch actually controls.

The exemption is narrow on purpose. The sidebar squeeze causes overflow and a sideways scroll; it
does not make two cells in a row overlap. A collision therefore still fails at 375px, so a genuine
POD regression at that width cannot hide behind this issue.

## When fixing it

Delete `375` from `KNOWN_SQUEEZE_WIDTHS` in `tests/pod-layout.spec.mjs` and the test goes back to
demanding a real pass at that width. Re-run against `/dashboard` and `/jobs` too, since they share
the cause and `/dashboard` is the harder case.
