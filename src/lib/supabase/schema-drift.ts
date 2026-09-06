/**
 * Recognising "that column isn't there yet".
 *
 * Migrations in this repo are applied by hand in the Supabase SQL editor (see
 * CLAUDE.md) — nothing in CI or deploy runs them. So there is always a window
 * where deployed code writes a column the database doesn't have, and the
 * established way through it is to retry without that column rather than fail the
 * whole request. This is the shared predicate for that, so each call site doesn't
 * re-guess the error codes.
 *
 * Two codes mean the same thing here:
 *   42703   — Postgres: `column "x" of relation "y" does not exist`
 *   PGRST204 — PostgREST: the column isn't in its schema cache, which is what
 *              you get when the column was added but the cache is stale, and
 *              also what a genuinely missing column looks like through the API.
 */

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

/**
 * True when `error` says a column is missing. Pass `column` to also require that
 * the error names that specific one — worth doing whenever more than one optional
 * column is in the payload, so a retry drops the right one.
 */
export function isMissingColumn(error: unknown, column?: string): boolean {
  const candidate = error as { code?: string; message?: string } | null | undefined;
  if (!candidate?.code || !MISSING_COLUMN_CODES.has(candidate.code)) return false;
  if (!column) return true;
  return (candidate.message || '').includes(column);
}

/** Drop keys from every row of an insert payload, for the retry after the above. */
export function withoutColumns<T extends Record<string, unknown>>(
  rows: T[],
  columns: string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const column of columns) delete copy[column];
    return copy;
  });
}
