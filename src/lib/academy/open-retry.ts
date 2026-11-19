/** The step of opening a thread that failed — logged, never shown. */
export type OpenStep = 'session' | 'open-thread' | 'stream-token' | 'stream-watch';

/**
 * One silent automatic retry of a failed thread open (brief 2026-11-18, 2.1: the
 * first open sometimes failed and "נסה שוב" always worked). `fail` logs the failing
 * step and returns the delay before the retry, or null once the automatic retry is
 * spent — then the error and the manual "נסה שוב" show as before.
 */
export function createOpenRetry(opts: { max?: number; delayMs?: number; log?: (msg: string, step: OpenStep, err?: unknown) => void } = {}) {
  const max = opts.max ?? 1;
  const delayMs = opts.delayMs ?? 700;
  const log = opts.log ?? ((msg, step, err) => console.error(msg, step, err));
  let used = 0;
  return {
    fail(step: OpenStep, err?: unknown): number | null {
      log('academy thread open failed at', step, err);
      if (used >= max) return null;
      used += 1;
      return delayMs * used;
    },
    get exhausted() { return used >= max; },
  };
}
