/* WCAG 2.1 relative luminance and contrast ratio.
   Formulae: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
             https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */

function expand(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) return h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return h;
}

export function relativeLuminance(hex: string): number {
  const h = expand(hex);
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
