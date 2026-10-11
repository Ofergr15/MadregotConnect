// ═════════════════════════════════════════════════════════════════════════════
// WHAT WE ACTUALLY KNOW ABOUT A DAY ON THE WATCH — per date, from the athlete's
// confirmed `workout_deliveries` rows.
//
// Eyal, 2026-10-11: the app said "בשעון ✓" and the watch had nothing. A 'success'
// row proves the workout is on the Garmin Connect ACCOUNT (read back after the
// push); the watch only gets it on its next sync with the phone, and nothing we
// can read says that happened. Sunday was also sent three times in 23 minutes,
// and every re-send deletes the copy before it, so a watch that synced in between
// held a workout that no longer existed. 8 of 15 Sunday runners ran it from the
// watch, against 12-16 on other days.
//
// So three honest states instead of one dishonest one:
//   sent     the account has it; sync the watch.
//   updated  a later send replaced the first; whoever synced must sync again.
//   ran      an activity came in stamped with the workout (device_confirmed_at),
//            the only proof it was really on the watch.
// ═════════════════════════════════════════════════════════════════════════════

export interface DeliveryRow { workout_date: string; created_at: string; device_confirmed_at?: string | null }

export interface WatchDay {
  /** The latest confirmed send for the date. */
  sentAt: string;
  /** Set when an earlier send for the date was replaced; equals sentAt then. */
  updatedAt: string | null;
  ran: boolean;
}

/** Rows written by one push land within seconds of each other (a double day writes two). */
const SAME_PUSH_MS = 2 * 60_000;

export function watchDays(rows: DeliveryRow[]): Record<string, WatchDay> {
  const byDate = new Map<string, DeliveryRow[]>();
  for (const r of rows) {
    if (!r.workout_date || !r.created_at) continue;
    const list = byDate.get(r.workout_date) ?? [];
    list.push(r);
    byDate.set(r.workout_date, list);
  }
  const out: Record<string, WatchDay> = {};
  for (const [date, list] of byDate) {
    const times = list.map((r) => new Date(r.created_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
    if (!times.length) continue;
    const first = times[0], last = times[times.length - 1];
    const sentAt = new Date(last).toISOString();
    out[date] = {
      sentAt,
      updatedAt: last - first > SAME_PUSH_MS ? sentAt : null,
      ran: list.some((r) => !!r.device_confirmed_at),
    };
  }
  return out;
}

export type WatchDayState = 'ran' | 'updated' | 'sent' | 'none';

export function watchDayState(day: WatchDay | undefined): WatchDayState {
  if (!day) return 'none';
  if (day.ran) return 'ran';
  return day.updatedAt ? 'updated' : 'sent';
}

/** "20:43" in Israel time, for "עודכן ב־20:43". */
export function israelClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
