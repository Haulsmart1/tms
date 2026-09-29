/*
  Pure rules for recording a walkaround defect photo (the two photo routes
  under app/api/driver/walkaround/photos). The cap is checked when the upload
  URL is issued and again when the photo is recorded, because several uploads
  can be started before any of them is recorded.
*/

export const MAX_PHOTOS_PER_DEFECT = 5;

/** The record route's 409 when another photo was recorded at the same moment. The driver queue retries it. */
export const PHOTO_RACE_MESSAGE = "Try again.";

export type PhotoAppendDecision = "already" | "full" | "append";

/** What to do with `path` given the paths already on the defect. A repeat is idempotent, even at the cap. */
export function photoAppendDecision(current: readonly string[], path: string): PhotoAppendDecision {
  if (current.includes(path)) return "already";
  if (current.length >= MAX_PHOTOS_PER_DEFECT) return "full";
  return "append";
}

/*
  A Postgres text[] literal for a PostgREST equality filter, so an update only
  applies when photo_paths is still exactly what was read. Every element is
  quoted, so commas, braces and spaces in a path cannot change its meaning.
*/
export function postgresTextArray(values: readonly string[]): string {
  const escape = (v: string) => v.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const quoted = values.map((v) => '"' + escape(v) + '"');
  return `{${quoted.join(",")}}`;
}
