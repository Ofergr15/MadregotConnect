const pad2 = (n: number) => String(n).padStart(2, '0');

// Local YYYY-MM-DD for "today + N days" — same date shape the datetime-local
// / scheduledAt string already uses, just computed from a day offset instead
// of typed by hand.
export function dateOffsetStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// The real delivery precision: /api/cron/notifications scans scheduled_notifications
// every minute (vercel.json; it was the 5-minute tick until 2026-10-18 — Ofer: "why
// must it be 5 minutes?"). The chooser offers exactly that grid, no finer.
export const SCHEDULE_STEP_MIN = 1;

const TZ = 'Asia/Jerusalem';
const DAY_MS = 86_400_000;

/** Israel's wall clock at `ms`: [y, m (1-12), d, h, min, s]. */
function israelParts(ms: number): [number, number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}

/** The UTC moment of an Israeli wall-clock time (DST-correct, either side of a change). */
export function israelWallToUtc(y: number, m: number, d: number, h: number, min: number, sec = 0): number {
  const want = Date.UTC(y, m - 1, d, h, min, sec);
  let guess = want;
  // Two passes settle the offset, including on the day the clocks move.
  for (let i = 0; i < 2; i++) {
    const [gy, gm, gd, gh, gmin, gs] = israelParts(guess);
    guess += want - Date.UTC(gy, gm - 1, gd, gh, gmin, gs);
  }
  return guess;
}

/**
 * A recurring notification's next run after `nowMs`: the same Israeli wall-clock time,
 * `interval` days or weeks on, as many steps as it takes to be in the future.
 *
 * It used to add whole UTC days, once: across the October clock change a weekly 08:00
 * became 07:00, and a row whose runs had been missed (crons paused, a start date in the
 * past) re-sent once per tick until it caught up — every one of those to the whole audience.
 */
export function nextRecurrence(currentIso: string, interval: number, unit: string, nowMs: number): string {
  const stepDays = Math.max(1, Math.floor(interval)) * (unit === 'week' ? 7 : 1);
  const [y, m, d, h, min, sec] = israelParts(Date.parse(currentIso));
  const base = Date.UTC(y, m - 1, d);
  for (let k = 1; k < 5000; k++) {
    const day = new Date(base + k * stepDays * DAY_MS);
    const at = israelWallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min, sec);
    if (at > nowMs) return new Date(at).toISOString();
  }
  return new Date(nowMs + stepDays * DAY_MS).toISOString();
}

/** A time that has already gone by (a minute's grace for the time it took to tap "send"). */
export const isPastSchedule = (iso: string | null | undefined, nowMs: number) =>
  !!iso && Number.isFinite(Date.parse(iso)) && Date.parse(iso) < nowMs - 60_000;

export function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/** The 5-minute tick's grid — what the academy's morning reminder still runs on. */
export const TICK_STEP_MIN = 5;

export function roundToStep(hhmm: string, step: number = SCHEDULE_STEP_MIN): string {
  const [h, m] = hhmm.split(':').map(Number);
  return minutesToHHMM(Math.round((h * 60 + m) / step) * step);
}

export interface NotificationStatusRow {
  status: string;
  schedule_type: string;
  sent_count: number;
  recur_interval: number | null;
  recur_unit: string | null;
  next_run_at: string | null;
  audience_type: string;
}

export type StatusIconKind = 'sent' | 'cancelled' | 'recurring' | 'scheduled';

// Hebrew counts one and two with their own words — "every 1 weeks" is how the
// weekly row used to read. Three and up take the number and the plural.
function recurrenceText(interval: number | null, unit: string | null): string {
  const week = unit === 'week';
  if (interval == null || interval <= 1) return week ? 'כל שבוע' : 'כל יום';
  if (interval === 2) return week ? 'כל שבועיים' : 'כל יומיים';
  return `כל ${interval} ${week ? 'שבועות' : 'ימים'}`;
}

// Human status/audience text + icon/color for one admin notification row —
// pure string/enum computation over the row's own fields, no DB or Date.now()
// dependency (next_run_at is a stored timestamp string, just formatted here).
export function describeNotificationRow(n: NotificationStatusRow): {
  statusText: string;
  audienceText: string;
  iconKind: StatusIconKind;
  iconBg: string;
} {
  const statusText = n.status === 'sent' ? `נשלח (${n.sent_count})`
    : n.status === 'cancelled' ? 'בוטל'
    : n.schedule_type === 'recurring' ? recurrenceText(n.recur_interval, n.recur_unit)
    : n.next_run_at ? new Date(n.next_run_at).toLocaleString('he-IL') : 'מתוזמן';
  const audienceText = n.audience_type === 'all' ? 'הכל' : n.audience_type === 'group' ? 'קבוצה' : n.audience_type === 'academy' ? 'אקדמיה' : 'אדם';
  const iconKind: StatusIconKind = n.status === 'sent' ? 'sent' : n.status === 'cancelled' ? 'cancelled' : n.schedule_type === 'recurring' ? 'recurring' : 'scheduled';
  // Light-system fills for the row's icon tile: sent = the accent green, still
  // pending = the designer's one warning colour (band 3), cancelled = a grey that
  // reads as "nothing will happen here" on a white card.
  const iconBg = n.status === 'sent' ? 'bg-accent-600' : n.status === 'cancelled' ? 'bg-ink-300' : 'bg-band-3';
  return { statusText, audienceText, iconKind, iconBg };
}
