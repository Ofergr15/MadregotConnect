/**
 * Where a one-day session's send to the watches stands, runner by runner (mockup
 * watch-send-v3, screens 4–6). Pure: the rows are workout_deliveries for the date with no
 * plan (lib/day-session/watch.ts writes them), the answer is what the tracking screen draws.
 *
 * A send writes a QUEUE row per runner first (`workout_data.queued`), so a runner is on the
 * screen from the moment the coach taps "לשלוח", before Garmin has been called. The worker
 * marks it started, then deletes it on success (push-week has written the real row) or turns
 * it into the failure with Garmin's reason. A queue row older than STALE_MS means the worker
 * died with it: the runner reads as failed, so a send can never hang on "בתור" forever.
 */

export type WatchState = 'ok' | 'waiting' | 'sending' | 'queued' | 'failed';

export interface DeliveryLike {
  athlete_id: string;
  status: 'pending' | 'success' | 'failed' | string;
  garmin_workout_id?: string | null;
  provider?: string | null;
  device_confirmed_at?: string | null;
  superseded_at?: string | null;
  error_message?: string | null;
  workout_data?: Record<string, unknown> | null;
  created_at: string;
}

export interface RunnerStatus {
  athleteId: string;
  state: WatchState;
  error: string | null;
  /** When it landed (or failed); null while on the way. */
  at: string | null;
}

export const STALE_MS = 6 * 60 * 1000;
export const INTERRUPTED = 'השליחה נקטעה באמצע. לשלוח שוב.';

const isQueue = (r: DeliveryLike) => !!r.workout_data && r.workout_data.queued === true;

/** One runner's rows → one state. The newest attempt wins. */
export function runnerState(rows: DeliveryLike[], now: number = Date.now()): RunnerStatus | null {
  const live = rows.filter((r) => !r.superseded_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!live.length) return null;
  const id = live[0].athlete_id;
  const queue = live.filter(isQueue).at(-1);
  if (queue) {
    if (queue.status === 'failed') return { athleteId: id, state: 'failed', error: queue.error_message || null, at: queue.created_at };
    if (now - Date.parse(queue.created_at) > STALE_MS) return { athleteId: id, state: 'failed', error: INTERRUPTED, at: queue.created_at };
    return { athleteId: id, state: queue.workout_data?.started ? 'sending' : 'queued', error: null, at: null };
  }
  const real = live.filter((r) => !isQueue(r));
  const apple = real.filter((r) => r.provider === 'apple').at(-1);
  if (apple) {
    return apple.device_confirmed_at
      ? { athleteId: id, state: 'ok', error: null, at: apple.device_confirmed_at }
      : { athleteId: id, state: 'waiting', error: null, at: apple.created_at };
  }
  const ok = real.filter((r) => r.status === 'success').at(-1);
  if (ok) return { athleteId: id, state: 'ok', error: null, at: ok.created_at };
  const failed = real.filter((r) => r.status === 'failed').at(-1);
  if (failed) return { athleteId: id, state: 'failed', error: failed.error_message || null, at: failed.created_at };
  // A Garmin row still 'pending': created, not yet verified — the push is under way.
  return { athleteId: id, state: 'sending', error: null, at: null };
}

export function statusOf(rows: DeliveryLike[], now: number = Date.now()): RunnerStatus[] {
  const by = new Map<string, DeliveryLike[]>();
  for (const r of rows) by.set(r.athlete_id, [...(by.get(r.athlete_id) ?? []), r]);
  return [...by.values()].map((rs) => runnerState(rs, now)).filter((s): s is RunnerStatus => !!s);
}

export interface WatchCounts { ok: number; waiting: number; failed: number; onTheWay: number; total: number }

export function countsOf(list: Pick<RunnerStatus, 'state'>[]): WatchCounts {
  const c = { ok: 0, waiting: 0, failed: 0, onTheWay: 0, total: list.length };
  for (const s of list) {
    if (s.state === 'ok') c.ok++;
    else if (s.state === 'waiting') c.waiting++;
    else if (s.state === 'failed') c.failed++;
    else c.onTheWay++;
  }
  return c;
}

/** Garmin's errors in words a coach can act on. */
export function reasonText(error: string | null): string {
  if (!error) return 'לא הגיע';
  if (error === INTERRUPTED) return error;
  if (/auth|token|401|403|unauthori/i.test(error)) return 'החיבור לגרמין פג. צריך להתחבר מחדש';
  if (/429|rate|too many/i.test(error)) return 'גרמין עמוס. לנסות שוב עוד כמה דקות';
  if (/5\d\d|timeout|ETIMEDOUT|ECONN|network/i.test(error)) return 'גרמין לא ענה. לנסות שוב';
  if (/No Garmin auth/i.test(error)) return 'אין שעון מחובר';
  return 'גרמין לא קיבל את האימון';
}
