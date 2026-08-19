/* The travel-time matrix crosses a JSON boundary between the API route and
   this client. parseMatrix marks unreachable cells Number.POSITIVE_INFINITY,
   but JSON.stringify writes Infinity as null, so what arrives is
   (number | null)[][]. bestOrder's precondition is non-negative, non-NaN
   numbers with Infinity allowed, and a null coerces to 0 in its arithmetic,
   which would make unreachable hops look free. This restores the contract at
   the boundary. */
export function sanitizeTravelSeconds(raw: unknown, n: number): number[][] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const matrix: number[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== n) return null;
    matrix.push(
      row.map((v) => (typeof v === "number" && !Number.isNaN(v) && v >= 0 ? v : Number.POSITIVE_INFINITY))
    );
  }
  return matrix;
}
