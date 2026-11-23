/**
 * Run `fn` over `items` with at most `size` in flight, batch after batch (cron/badges, night queue #60).
 * Batches, not a pool: each batch waits for its slowest member, which keeps the DB load flat and the
 * order of completion easy to reason about. `fn` must not throw (callers catch per item).
 */
export async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
  }
}
