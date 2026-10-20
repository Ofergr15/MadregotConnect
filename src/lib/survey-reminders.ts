import { israelWallToUtc } from '@/lib/notifications/scheduling';

/**
 * WHEN A POLL CLOSES AND WHEN IT REMINDS (mockup ~/.cache/madregot/polls-proposal.html, Ofer
 * 2026-10-20: "a manual close date, and several reminders — a week, 24 hours and an hour before").
 *
 * Pure, so the rules are tested without a clock or a database:
 *  - a close is an Israel wall-clock date + time; the quick buttons only fill those in;
 *  - each reminder is "this long before the close", or a time the staff picked;
 *  - a reminder that lands at night (22:00–07:00) moves to 07:00 — a poll is not worth a
 *    phone lighting up at midnight;
 *  - one whose time has passed, or that the night rule pushed past the close, is not sent
 *    (the publish screen shows it greyed, so the staff see why it is missing).
 * The reminders themselves are scheduled_notifications rows (kind 'survey_reminder', linked by
 * survey_id) that /api/cron/notifications sends to whoever has not answered by then.
 */

export const REMINDER_KIND = 'survey_reminder';
export type ReminderKey = 'week' | 'day' | 'hour';
export const REMINDER_KEYS: ReminderKey[] = ['week', 'day', 'hour'];
const BEFORE_MIN: Record<ReminderKey, number> = { week: 7 * 24 * 60, day: 24 * 60, hour: 60 };

export const NIGHT_FROM = 22;
export const MORNING = 7;

function israelParts(ms: number): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** "2026-10-29" + "20:00" in Israel → ISO instant. Null when either is malformed. */
export function israelLocalToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return null;
  return new Date(israelWallToUtc(+d[1], +d[2], +d[3], +t[1], +t[2])).toISOString();
}

/** An instant as Israel's date and time, for the form ("2026-10-29", "20:00"). */
export function israelDateTime(iso: string): { date: string; time: string; dow: number } {
  const p = israelParts(Date.parse(iso));
  const two = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.y}-${two(p.m)}-${two(p.d)}`, time: `${two(p.h)}:${two(p.min)}`, dow: p.dow };
}

export type ClosePreset = 'today' | 'tomorrow' | 'week';

/** What each quick button fills in: today 22:00, tomorrow 20:00, a week from today 20:00. */
export function closePreset(p: ClosePreset, now: Date = new Date()): { date: string; time: string } {
  const days = p === 'today' ? 0 : p === 'tomorrow' ? 1 : 7;
  const { date } = israelDateTime(new Date(now.getTime() + days * 86_400_000).toISOString());
  return { date, time: p === 'today' ? '22:00' : '20:00' };
}

/** Out of the night: 22:00–06:59 → the next 07:00. */
export function outOfNight(ms: number): { ms: number; moved: boolean } {
  const p = israelParts(ms);
  if (p.h >= MORNING && p.h < NIGHT_FROM) return { ms, moved: false };
  const morning = israelWallToUtc(p.y, p.m, p.d, MORNING, 0);
  return { ms: p.h < MORNING ? morning : israelWallToUtc(p.y, p.m, p.d, MORNING, 0) + 86_400_000, moved: true };
}

export interface PlannedReminder {
  /** 'week' | 'day' | 'hour', or 'custom'. */
  key: ReminderKey | 'custom';
  at: string;
  /** The night rule moved it to 07:00. */
  moved: boolean;
  /** Not sent: its time has passed, or it would land after the close. */
  skip: boolean;
}

/**
 * The reminders a poll will send. `picked` are the before-close ones that are ticked;
 * `custom` are instants the staff typed. Sorted, with two that land on the same minute kept once.
 */
export function planReminders(closesAt: string | null, picked: ReminderKey[], custom: string[] = [], now: Date = new Date()): PlannedReminder[] {
  if (!closesAt) return [];
  const close = Date.parse(closesAt);
  if (!Number.isFinite(close)) return [];
  const out: PlannedReminder[] = [];
  const add = (key: PlannedReminder['key'], raw: number) => {
    const { ms, moved } = outOfNight(raw);
    out.push({ key, at: new Date(ms).toISOString(), moved, skip: ms <= now.getTime() + 60_000 || ms >= close });
  };
  // A day or a week before is the same clock time on that day, across a clock change too;
  // an hour before is an hour.
  const c = israelParts(close);
  // Date.UTC rolls a day before the 1st back into the previous month.
  const daysBefore = (n: number) => israelWallToUtc(c.y, c.m, c.d - n, c.h, c.min);
  for (const k of REMINDER_KEYS) {
    if (!picked.includes(k)) continue;
    add(k, k === 'hour' ? close - BEFORE_MIN.hour * 60_000 : daysBefore(k === 'week' ? 7 : 1));
  }
  for (const c of custom) { const ms = Date.parse(c); if (Number.isFinite(ms)) add('custom', ms); }
  const seen = new Set<string>();
  return out.sort((a, b) => a.at.localeCompare(b.at)).filter((r) => {
    if (r.skip) return true;
    if (seen.has(r.at)) return false;
    seen.add(r.at); return true;
  });
}

/** Read a request's reminders: the ticked keys and up to five custom ISO instants. */
export function readReminders(raw: unknown): { picked: ReminderKey[]; custom: string[] } {
  const r = (raw || {}) as { picked?: unknown; custom?: unknown };
  const picked = Array.isArray(r.picked) ? REMINDER_KEYS.filter((k) => (r.picked as unknown[]).includes(k)) : [];
  const custom = Array.isArray(r.custom) ? (r.custom as unknown[]).filter((c): c is string => typeof c === 'string' && Number.isFinite(Date.parse(c))).slice(0, 5) : [];
  return { picked, custom };
}
