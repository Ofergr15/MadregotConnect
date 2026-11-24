/**
 * Time budget + resume cursor for the serial cron sweeps (QA 24.11 Q24-4).
 *
 * Vercel kills a function at its maxDuration with no chance to write anything, so a sweep
 * that runs out of time loses its summary and starts again from the top tomorrow — the
 * same athletes first, the same ones never reached. Each sweep now checks a deadline
 * between athletes, stops a little before the ceiling, and leaves a cursor (the last id
 * it finished) in app_settings so the next run starts after it.
 */

/** maxDuration is 300 s; stop at 270 so the summary and cursor writes still land. */
export const SWEEP_BUDGET_MS = 270_000;

export function deadlineFrom(startMs: number = Date.now(), budgetMs: number = SWEEP_BUDGET_MS): () => boolean {
  return () => Date.now() - startMs >= budgetMs;
}

/**
 * Sorted by id, rotated to start after `cursor` (wrapping), so a run that was cut short
 * resumes with the athletes it never reached. No cursor = from the top.
 */
export function rotateAfter<T extends { id: string }>(items: T[], cursor: string | null | undefined): T[] {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!cursor) return sorted;
  const i = sorted.findIndex((x) => x.id > cursor);
  return i <= 0 ? sorted : [...sorted.slice(i), ...sorted.slice(0, i)];
}

type Db = { from: (table: string) => any };

/** Best-effort read; null on no row, no table or any error. */
export async function readCursor(supabase: Db, key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error || !data) return null;
    const v = (data as { value?: unknown }).value;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** Best-effort write; `null` clears it (a sweep that finished starts from the top next time). */
export async function saveCursor(supabase: Db, key: string, cursor: string | null): Promise<void> {
  try {
    const { error } = await supabase.from('app_settings').upsert(
      { key, value: cursor ?? '', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) console.error(`${key} not saved:`, error);
  } catch (err) {
    console.error(`${key} not saved:`, err);
  }
}
