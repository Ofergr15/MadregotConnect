// ═════════════════════════════════════════════════════════════════════════════
// "YOUR WEEK" — the opt-in Sunday push (night task 54). DRY-RUN ONLY for now.
//
// Sent (one day) on Sunday evening, which is where the club's two week anchors
// (CLAUDE.md "Week starts — TWO anchors") pull apart hardest:
//
//   activity week  Mon → Sun   closes TONIGHT (the watch's week)
//   plan week      Sun → Sat   closed LAST NIGHT; today is day 1 of the next one
//
// So a Sunday-morning run belongs to the activity week being summarised but to
// the NEXT plan week, and last Sunday's long run is in the plan week that just
// closed but in the PREVIOUS activity week. The push states both numbers rather
// than picking one, for the same reason the app does (a total nobody can
// reconcile against their watch gets reported as a bug).
//
// Everything here is pure: dates in, numbers and copy out.
// ═════════════════════════════════════════════════════════════════════════════

import { activityLocalDateStr, addDaysToDateStr } from '@/lib/utils';
import type { NotificationLocale } from '@/lib/notifications/locale';

export const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'] as const;

export interface YourWeekWindows {
  /** Monday of the activity week closing on `sunday` (inclusive). */
  activityWeekStart: string;
  /** Exclusive end of that activity week (the next Monday). */
  activityWeekEnd: string;
  /** Sunday the plan week that closed yesterday started on (inclusive). */
  planWeekStart: string;
  /** Exclusive end of that plan week (= `sunday`). */
  planWeekEnd: string;
}

/** True for a YYYY-MM-DD that is a Sunday. */
export function isSunday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
}

/** Both windows for the Sunday `sunday` (Israel calendar date, YYYY-MM-DD). */
export function yourWeekWindows(sunday: string): YourWeekWindows {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sunday) || !isSunday(sunday)) throw new Error(`not a Sunday: ${sunday}`);
  const activityWeekStart = addDaysToDateStr(sunday, -6);
  return {
    activityWeekStart,
    activityWeekEnd: addDaysToDateStr(sunday, 1),
    planWeekStart: addDaysToDateStr(sunday, -7),
    planWeekEnd: sunday,
  };
}

export interface ActivityRow { start_time: string; distance: number | null; duration?: number | null; activity_type?: string | null }

export interface YourWeekNumbers {
  activityKm: number;
  activityRuns: number;
  planWeekKm: number;
  planWeekRuns: number;
}

const isRun = (a: ActivityRow) => (a.distance ?? 0) > 0 && (!a.activity_type || (RUN_TYPES as readonly string[]).includes(a.activity_type));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Fold one athlete's activities into both weeks. Dates come from
 * `activityLocalDateStr` (start_time is the athlete's wall clock stored as UTC),
 * never from `new Date(start_time)` in the server's zone.
 */
export function yourWeekNumbers(sunday: string, activities: readonly ActivityRow[]): YourWeekNumbers {
  const w = yourWeekWindows(sunday);
  let aKm = 0; let aRuns = 0; let pKm = 0; let pRuns = 0;
  for (const a of activities) {
    if (!isRun(a)) continue;
    const day = activityLocalDateStr(a.start_time);
    const km = (a.distance ?? 0) / 1000;
    if (day >= w.activityWeekStart && day < w.activityWeekEnd) { aKm += km; aRuns += 1; }
    if (day >= w.planWeekStart && day < w.planWeekEnd) { pKm += km; pRuns += 1; }
  }
  return { activityKm: round1(aKm), activityRuns: aRuns, planWeekKm: round1(pKm), planWeekRuns: pRuns };
}

/** Nothing to say about a week with no runs in either window. */
export function shouldSend(n: YourWeekNumbers): boolean {
  return n.activityRuns > 0 || n.planWeekRuns > 0;
}

export function yourWeekCopy(locale: NotificationLocale, n: YourWeekNumbers): { title: string; body: string } {
  if (locale === 'he') {
    return {
      title: 'השבוע שלך 🏃',
      body: `${n.activityKm} ק״מ ב-${n.activityRuns} ריצות השבוע (שני–ראשון, כמו בשעון) · ${n.planWeekKm} ק״מ בשבוע התוכנית שהסתיים (ראשון–שבת)`,
    };
  }
  return {
    title: 'Your week 🏃',
    body: `${n.activityKm} km in ${n.activityRuns} runs this week (Mon–Sun, like your watch) · ${n.planWeekKm} km in the plan week that just ended (Sun–Sat)`,
  };
}

export const YOUR_WEEK_URL = '/feed?weekStory=1';
