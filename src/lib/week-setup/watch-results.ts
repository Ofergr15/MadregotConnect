import { addDays } from './model';

/**
 * WHO HAS THE WEEK ON THEIR WATCH (Ofer, 10-24; the week-setup v2 mockup's "לא קיבלו").
 *
 * A send's per-runner results used to live only in the reply to whoever pressed the button,
 * and one staff push — the weeks of 11.10 and 18.10 ended "partial" and nothing said who.
 * The send route (api/garmin/push-workouts) now keeps them per week: a whole send replaces
 * the record, a resend to some runners updates only theirs. The plan's status is read from
 * the whole record, so a resend to the two who failed can't call the week "draft" when the
 * other nineteen have it (it used to count only the resend). In app_settings.week_watch_results.
 */

export interface RunnerResult { name: string; ok: boolean; error?: string; at: string }
export interface WeekWatchResults { at: string; by: string; runners: Record<string, RunnerResult> }
export type WatchResultsStore = Record<string, WeekWatchResults>;
export const WATCH_RESULTS_KEY = 'week_watch_results';

export interface PushOutcome { athleteId: string; athleteName?: string; status: 'success' | 'failed' | string; error?: string }

/** The week's record after a send: `partial` = a resend to some runners (theirs updated), else replaced. */
export function withResults(store: WatchResultsStore | null | undefined, weekStart: string, outcomes: PushOutcome[],
  opts: { partial: boolean; by: string; now: string; today: string }): WatchResultsStore {
  const cutoff = addDays(opts.today, -35);
  const next: WatchResultsStore = {};
  for (const [w, r] of Object.entries(store || {})) if (w >= cutoff) next[w] = r;
  const runners: Record<string, RunnerResult> = opts.partial ? { ...(next[weekStart]?.runners || {}) } : {};
  for (const o of outcomes) {
    runners[o.athleteId] = { name: o.athleteName || runners[o.athleteId]?.name || '', ok: o.status === 'success', ...(o.status === 'success' || !o.error ? {} : { error: String(o.error).slice(0, 140) }), at: opts.now };
  }
  next[weekStart] = { at: opts.now, by: opts.by, runners };
  return next;
}

/** How many have it, of how many, and who doesn't. */
export function summarize(r: WeekWatchResults | null | undefined): { ok: number; total: number; failed: Array<{ id: string; name: string; error?: string }> } {
  const list = Object.entries(r?.runners || {});
  const failed = list.filter(([, x]) => !x.ok).map(([id, x]) => ({ id, name: x.name, ...(x.error ? { error: x.error } : {}) }));
  return { ok: list.length - failed.length, total: list.length, failed };
}

/** The plan's status from the whole record: everyone has it → pushed; some → partial; none → draft. */
export function statusOf(r: WeekWatchResults, wholeWeek: boolean): 'pushed' | 'partial' | 'draft' {
  const { ok, total } = summarize(r);
  return ok === total && total > 0 && wholeWeek ? 'pushed' : ok > 0 ? 'partial' : 'draft';
}
