import { errorFields, log } from './log';

/**
 * One error summary per cron run (task 64). A cron job is a list of best-effort
 * steps, each wrapped in its own try/catch so one failure doesn't stop the rest —
 * which also meant a failure only ever showed up as one console.error among
 * hundreds of lines. `fail(step, err)` keeps logging that line (scrubbed) and
 * records it; `finish()` writes ONE `cron.summary` line and returns the summary so
 * the route can include it in its JSON answer.
 */
export interface CronStepFailure { step: string; errorName: string; message: string; code?: string }

export interface CronSummary {
  cron: string;
  requestId: string | null;
  durationMs: number;
  ok: boolean;
  failedCount: number;
  failed: CronStepFailure[];
}

export function startCronRun(cron: string, requestId: string | null = null, now: () => number = Date.now) {
  const t0 = now();
  const failed: CronStepFailure[] = [];
  return {
    fail(step: string, err: unknown) {
      // The stack goes on the step's own log line only; the summary (also returned
      // in the route's JSON answer) stays name + message.
      const { stack, ...f } = { step, ...errorFields(err) };
      failed.push(f);
      log('error', 'cron.step_failed', { cron, requestId, ...f, ...(stack ? { stack } : {}) });
    },
    finish(extra: Record<string, unknown> = {}): CronSummary {
      const summary: CronSummary = {
        cron, requestId, durationMs: now() - t0, ok: failed.length === 0, failedCount: failed.length, failed: [...failed],
      };
      log(failed.length ? 'warn' : 'info', 'cron.summary', { ...summary, ...extra });
      return summary;
    },
  };
}
