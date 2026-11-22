/**
 * QUIET HOURS (settings rev 3, Ofer 2026-11-21 Q6).
 *
 * Stored in `athletes.notification_prefs.quietHours` = { enabled, from, to } ("HH:MM",
 * Israel wall clock). Absent = the default: ON, 22:00–07:00 — so every member gets a
 * quiet night without opening the screen.
 *
 * Inside the window a push is not sent, except:
 *  - `coach_message` — a coach writing to this one runner directly always breaks through.
 *  - DEFERRED_KINDS (a pain report to staff) — not dropped: re-sent at the end of THAT
 *    staff member's own window (`quiet_deferred` row in scheduled_notifications).
 * Everything else that falls in the window is still written to the inbox by its sender
 * (persistNotifications runs regardless), so nothing is lost — only the buzz is.
 */
/** scheduled_notifications.kind of a staff alert held over the recipient's quiet hours. */
export const QUIET_DEFERRED_KIND = 'quiet_deferred';

export interface QuietHours { enabled: boolean; from: string; to: string }

export const QUIET_DEFAULT: QuietHours = { enabled: true, from: '22:00', to: '07:00' };
export const BREAKS_THROUGH_KINDS: readonly string[] = ['coach_message'];
export const DEFERRED_KINDS: readonly string[] = ['pain_report', 'pain_no_checkin'];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s: string) => { const m = HHMM.exec(s)!; return Number(m[1]) * 60 + Number(m[2]); };

export function readQuietHours(prefs: unknown): QuietHours {
  const q = (prefs as { quietHours?: unknown } | null | undefined)?.quietHours as Partial<QuietHours> | undefined;
  if (!q || typeof q !== 'object') return { ...QUIET_DEFAULT };
  return {
    enabled: typeof q.enabled === 'boolean' ? q.enabled : QUIET_DEFAULT.enabled,
    from: typeof q.from === 'string' && HHMM.test(q.from) ? q.from : QUIET_DEFAULT.from,
    to: typeof q.to === 'string' && HHMM.test(q.to) ? q.to : QUIET_DEFAULT.to,
  };
}

/** Validates a PATCH body; null = 400. */
export function readQuietPatch(v: unknown): QuietHours | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Record<string, unknown>;
  if (typeof q.enabled !== 'boolean') return null;
  if (typeof q.from !== 'string' || !HHMM.test(q.from)) return null;
  if (typeof q.to !== 'string' || !HHMM.test(q.to)) return null;
  if (q.from === q.to) return null;
  return { enabled: q.enabled, from: q.from, to: q.to };
}

/** Israel wall-clock minutes-of-day at `ms`. */
export function israelMinuteOfDay(ms: number): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === 'hour')?.value) * 60 + Number(p.find((x) => x.type === 'minute')?.value);
}

/** Whether `minute` (0..1439) lies in the window; windows may wrap midnight. */
export function inQuietWindow(q: QuietHours, minute: number): boolean {
  if (!q.enabled) return false;
  const a = toMin(q.from), b = toMin(q.to);
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}

/** Milliseconds from `ms` until the window ends (0 when not inside it). */
export function msUntilQuietEnds(q: QuietHours, ms: number): number {
  const now = israelMinuteOfDay(ms);
  if (!inQuietWindow(q, now)) return 0;
  const end = toMin(q.to);
  const mins = (end - now + 1440) % 1440;
  return mins * 60_000;
}

export type QuietDecision = 'send' | 'drop' | 'defer';

export function quietDecision(kind: string | undefined, q: QuietHours, ms: number): QuietDecision {
  if (!inQuietWindow(q, israelMinuteOfDay(ms))) return 'send';
  if (kind && BREAKS_THROUGH_KINDS.includes(kind)) return 'send';
  if (kind && DEFERRED_KINDS.includes(kind)) return 'defer';
  return 'drop';
}
