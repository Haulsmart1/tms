import { postgresTextArray } from "../walkaround/photoPaths";

/*
  The value for a PostgREST `ov` (array overlap) filter on
  job_items.serial_numbers (review S-11). postgrest-js joins an array argument
  with bare commas and quotes nothing, so a comma in a scanned serial split it
  in two and a quote or brace made the request fail. Passing this pre-built
  literal as a string instead makes postgrest-js send it untouched, and every
  element is quoted with quotes and backslashes escaped, so a serial is always
  exactly one element whatever it contains.
*/
export function serialOverlapLiteral(serials: readonly string[]): string {
  return postgresTextArray(serials);
}
