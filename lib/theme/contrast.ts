/* WCAG 2.1 relative luminance and contrast ratio.
   Formulae: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
             https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */

function expand(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) return h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return h;
}

/* Anything that isn't a plain 3- or 6-digit hex colour must be rejected rather
   than scored. Reading only the first 6 hex characters made an 8-digit
   #RRGGBBAA value get scored as if fully opaque, which is a silently wrong
   number, not a visible failure; and non-hex forms (rgba(), named colours,
   var() references, empty strings) previously slid through to NaN, which
   happened to fail a Vitest matcher by accident rather than by design. This
   module does no alpha compositing, so it should say so loudly instead of
   guessing. */
function toSixDigitHex(value: string): string {
  const h = expand(value);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(
      `contrast: expected a 3 or 6 digit hex colour, received ${JSON.stringify(value)}. ` +
        `Values carrying alpha (#RRGGBBAA) are rejected deliberately: this module does no ` +
        `compositing and would otherwise score them as fully opaque, which is a silently ` +
        `wrong answer rather than a visible failure.`,
    );
  }
  return h;
}

export function relativeLuminance(hex: string): number {
  const h = toSixDigitHex(hex);
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
