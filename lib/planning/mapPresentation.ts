export type PlanningMapMarkerPresentation = {
  text: string;
  title: string | null;
};

/**
 * Canonical physical locations may service many Drops at one coordinate.
 * Keep the map marker compact while retaining the complete list as a tooltip.
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

  return {
    text: `${parts[0]}+${parts.length - 1}`,
    title: `Drops ${parts.join(", ")}`,
  };
}
