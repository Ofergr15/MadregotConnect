const pad2 = (n: number) => String(n).padStart(2, '0');

// Local YYYY-MM-DD for "today + N days" — same date shape the datetime-local
// / scheduledAt string already uses, just computed from a day offset instead
// of typed by hand.
export function dateOffsetStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 5 min is the real delivery-precision ceiling (src/app/api/cron/tick scans
// scheduled_notifications every 5 min — see vercel.json) — the chooser only
// ever offers/stores values on that grid so it can't promise more than the
// backend delivers.
export const SCHEDULE_STEP_MIN = 5;

export function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

export function roundToStep(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return minutesToHHMM(Math.round((h * 60 + m) / SCHEDULE_STEP_MIN) * SCHEDULE_STEP_MIN);
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
    : n.schedule_type === 'recurring' ? `כל ${n.recur_interval} ${n.recur_unit === 'week' ? 'שבועות' : 'ימים'}`
    : n.next_run_at ? new Date(n.next_run_at).toLocaleString('he-IL') : 'מתוזמן';
  const audienceText = n.audience_type === 'all' ? 'הכל' : n.audience_type === 'group' ? 'קבוצה' : 'אדם';
  const iconKind: StatusIconKind = n.status === 'sent' ? 'sent' : n.status === 'cancelled' ? 'cancelled' : n.schedule_type === 'recurring' ? 'recurring' : 'scheduled';
  // Light-system fills for the row's icon tile: sent = the accent green, still
  // pending = the designer's one warning colour (band 3), cancelled = a grey that
  // reads as "nothing will happen here" on a white card.
  const iconBg = n.status === 'sent' ? 'bg-accent-600' : n.status === 'cancelled' ? 'bg-ink-300' : 'bg-band-3';
  return { statusText, audienceText, iconKind, iconBg };
}
