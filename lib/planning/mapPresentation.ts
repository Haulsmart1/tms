export type PlanningMapMarkerPresentation = {
  text: string;
  title: string | null;
};

/**
 * Returns a compact inclusive range only when every Drop number is numeric
 * and sequential in the canonical service order.
 */
function contiguousDropRange(parts: string[]): string | null {
  const numbers = parts.map((part) => Number(part));

  if (
    numbers.some(
      (number) =>
        !Number.isInteger(number) ||
        number < 1
    )
  ) {
    return null;
  }

  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) {
      return null;
    }
  }

  if (numbers.length < 2) {
    return null;
  }

  return `${numbers[0]}?${numbers[numbers.length - 1]}`;
}

/**
 * Canonical physical locations may service multiple Drops at one coordinate.
 *
 * Presentation rules:
 * - one Drop: show its number;
 * - multiple contiguous Drops: show an inclusive range;
 * - multiple non-contiguous Drops: show only the Drop count.
 *
 * Never use "first+count" wording because labels such as "95+67" can look
 * like malformed Drop numbers rather than a shared physical location.
 */
export function planningMapMarkerPresentation(
  label: string
): PlanningMapMarkerPresentation {
  const parts = label
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return {
      text: parts[0] ?? label,
      title: null,
    };
  }

  const range = contiguousDropRange(parts);

  return {
    text: range ?? `${parts.length} drops`,
    title: `Drops ${parts.join(", ")}`,
  };
}
