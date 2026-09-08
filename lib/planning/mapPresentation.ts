export type PlanningMapMarkerPresentation = {
  text: string;
  title: string | null;
};

function contiguousDropRange(parts: string[]): string | null {
  const numbers = parts.map((value) => Number(value));

  if (
    numbers.some(
      (value) => !Number.isInteger(value) || value < 1
    )
  ) {
    return null;
  }

  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] !== numbers[index - 1] + 1) {
      return null;
    }
  }

  return `${numbers[0]}\u2013${numbers[numbers.length - 1]}`;
}

/**
 * Canonical physical locations may service many Drops at one coordinate.
 * Keep the marker readable while retaining the complete Drop list as a tooltip.
 */
export function planningMapMarkerPresentation(
  label: string
): PlanningMapMarkerPresentation {
  const parts = label
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length <= 2) {
    return {
      text: label,
      title: null,
    };
  }

  const range = contiguousDropRange(parts);

  return {
    text: range ?? `${parts.length} drops`,
    title: `Drops ${parts.join(", ")}`,
  };
}
