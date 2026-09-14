/*
  Customer search filter for the PostgREST .or() expression (review ACC-19, audit L2).

  The value is double-quoted so PostgREST reserved characters (, . : ( ) ) in a
  search stay literal and cannot add or change filter terms. Inside the quotes
  backslash and double quote are removed, `*` is removed (PostgREST treats it as
  a wildcard), and the LIKE wildcards % and _ are escaped so they match
  literally. Control characters become spaces and the length is capped.
*/

export const CUSTOMER_SEARCH_COLUMNS = ["name", "legal_name", "trading_name", "account_code", "postcode"] as const;

const MAX_SEARCH_LENGTH = 100;

export function sanitizeSearchTerm(search: string): string {
  const cleaned = Array.from(search.slice(0, MAX_SEARCH_LENGTH))
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return " ";
      if (char === "\\" || char === '"' || char === "*") return "";
      return char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  // A backslash inside a quoted PostgREST value escapes the next character, so
  // "\\%" reaches Postgres as \% and LIKE matches a literal percent sign.
  return cleaned.replace(/[%_]/g, (char) => `\\\\${char}`);
}

/** Returns the .or() argument, or null when nothing searchable remains. */
export function buildCustomerSearchFilter(search: string | null | undefined): string | null {
  const term = sanitizeSearchTerm(String(search ?? ""));
  if (!term) return null;
  return CUSTOMER_SEARCH_COLUMNS.map((column) => `${column}.ilike."%${term}%"`).join(",");
}
