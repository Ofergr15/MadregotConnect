/**
 * Making user-typed text safe to put inside a Postgres `ILIKE` pattern, and then
 * inside a PostgREST filter string.
 *
 * Two separate hazards, which is why there are two functions and the order they
 * are applied in matters:
 *
 *  1. **`%` and `_` are wildcards to Postgres.** Searching for `a_b` quietly
 *     matched `axb`, and searching for `%` matched the entire table.
 *  2. **`.or()` takes a *string* of comma-separated conditions.** A comma in the
 *     query splits it into a condition PostgREST can't parse and the request
 *     comes back 400 — so a member typing "Cohen, Dana" got a broken search
 *     rather than no results. Parentheses do the same.
 */

/**
 * Backslash-escapes the LIKE metacharacters so the pattern matches the text the
 * user actually typed. Backslash itself has to go first (it is Postgres's
 * default LIKE escape character), which `[\\%_]` in one pass gives us for free.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => `\\${m}`);
}

/** `%foo%`, with anything wildcard-ish in `foo` neutralised. */
export function containsPattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

/**
 * Wraps a value for use inside a PostgREST filter string (`.or()`, `.and()`).
 *
 * PostgREST treats a double-quoted value as opaque, so commas and parentheses
 * inside it stop being delimiters. Within those quotes `"` and `\` are escaped
 * with a backslash — which means a pattern that already contains `\%` from
 * `escapeLike` correctly becomes `\\%` here, and PostgREST unescapes it back to
 * `\%` before Postgres sees it. Doubling is the right answer, not a bug.
 *
 * Only for filter strings. The single-column helpers (`.ilike('name', p)`) take
 * the raw value and encode it themselves — quoting there would search for the
 * quotes.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, m => `\\${m}`)}"`;
}
