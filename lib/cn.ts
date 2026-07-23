/**
 * Join truthy class names into one string.
 *
 * IMPORTANT: this COMPOSES, it does not OVERRIDE. Tailwind resolves
 * equal-specificity utilities by stylesheet order, not by the order they appear
 * in the class attribute. So passing `className="max-w-3xl"` to a component
 * whose base is `max-w-6xl` silently keeps max-w-6xl, and `px-0` against a base
 * of `px-4` is likewise ignored. Both verified in a browser.
 *
 * Where a component genuinely needs an override, give it an explicit prop
 * rather than relying on className. (tailwind-merge would fix this generally,
 * but its default config does not know this project's custom fontSize scale,
 * `text-overline` and `text-md`, so it risks mis-merging.)
 */
export function cn(...classes: Array<string | boolean | null | undefined>): string {
  return classes.filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
}
