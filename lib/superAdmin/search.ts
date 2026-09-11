/* The one search predicate for the /super-admin list pages.

   Every term must match SOME field, rather than the whole query matching one
   field. That is what makes "acme past" find the past-due Acme: the two terms
   land in different columns. The naive whole-query version finds nothing there,
   which reads to the operator as "no such company".

   Fields are declared by the caller, never derived by stringifying the row. A
   row carries ids, timestamps and flags the operator cannot see; if those were
   searchable, a query would return rows with no visible reason for matching.

   Pass the string the table renders, not the raw value: search should match what
   the operator can see. A cell showing "£1,234.50" searched as "1234.5" makes
   typing "1,234" return nothing.

   No diacritic folding: "muller" does not find "Müller Transport". Left out
   deliberately rather than missed. Fold both sides with NFD normalize if a
   customer list ever makes it worth the cost. */

export type SearchableField = string | null | undefined;

function terms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSearch(query: string, fields: readonly SearchableField[]): boolean {
  const needles = terms(query);
  if (needles.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => typeof field === "string")
    .join(" ")
    .toLowerCase();

  return needles.every((needle) => haystack.includes(needle));
}

export function filterBySearch<T>(
  query: string,
  rows: readonly T[],
  fieldsOf: (row: T) => readonly SearchableField[],
): T[] {
  if (terms(query).length === 0) return [...rows];
  return rows.filter((row) => matchesSearch(query, fieldsOf(row)));
}
