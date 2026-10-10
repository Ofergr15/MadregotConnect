// The "workouts sent to your watch" push, saying WHICH workouts — pure, shared
// by the Garmin delivery (lib/garmin/push-week.ts), the Apple ack, and the send
// sheet's preview in the planner, so what the coach previews is what goes out.
//
// Ofer, 2026-10-10: "if I loaded one workout or two, it has to say which" — and
// not "10 × 30 שנ׳", which is one block of a 75-minute session. A workout is
// named, in this order, by: the coach's own line from the send sheet; the
// coach's name for it in the plan when it says something ("חצי מרתון מרוץ
// הסרגל" — a bare day name is not a name); otherwise its type. Then km (the
// plan's range) and duration, from the runner's own group's version.
// Design: ~/.cache/madregot/notif-center/watch-push.html.

import type { ParsedWorkout } from '@/lib/ai/types';
import { classifyWorkout, type WorkoutType } from '@/lib/plans/session-summary';
import { nameQualifier } from '@/lib/plans/week-summary';
import type { NotificationLocale } from './locale';

type PushCopy = { title: string; body: string };

const DAYS: Record<NotificationLocale, string[]> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const TYPE: Record<NotificationLocale, Record<WorkoutType, string>> = {
  he: { easy: 'ריצה קלה', intervals: 'אימון חזרות', tempo: 'טמפו', fartlek: 'פארטלק', long_run: 'ריצה ארוכה', progressive: 'ריצה מתגברת', rest: 'מנוחה' },
  en: { easy: 'Easy run', intervals: 'Intervals', tempo: 'Tempo', fartlek: 'Fartlek', long_run: 'Long run', progressive: 'Progression run', rest: 'Rest' },
};

const U = {
  he: { km: 'ק״מ', min: 'דק׳', h: 'ש׳', morning: 'בוקר', evening: 'ערב', optional: 'אופציה', total: 'סה״כ', today: 'היום', tomorrow: 'מחר' },
  en: { km: 'km', min: 'min', h: 'h', morning: 'Morning', evening: 'Evening', optional: 'optional', total: 'Total', today: 'Today', tomorrow: 'Tomorrow' },
};

const MAX_BODY = 110;

/** The send sheet's key for one session: its day and its part on that day. */
export const slotKey = (w: Pick<ParsedWorkout, 'dayOfWeek' | 'partIndex'>) => `${w.dayOfWeek}:${w.partIndex ?? 1}`;

export interface LineOptions {
  /** Days (0 = Sunday) that are this week's quality days — they get a ⭐. */
  qualityDows?: number[];
  /** The coach's own lines from the send sheet, by slotKey. */
  lines?: Record<string, string>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function kmText(w: ParsedWorkout, locale: NotificationLocale): string {
  const min = num(w.distanceMinKm), max = num(w.distanceMaxKm);
  if (min === null && max === null) return '';
  const lo = Math.round(min ?? max!), hi = Math.round(max ?? min!);
  return `${lo === hi ? hi : `${Math.min(lo, hi)}–${Math.max(lo, hi)}`} ${U[locale].km}`;
}

function durationText(sec: number | null, locale: NotificationLocale): string {
  if (sec === null) return '';
  const minutes = Math.round(sec / 300) * 5;
  if (minutes <= 0) return '';
  if (minutes < 90) return `${minutes} ${U[locale].min}`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')} ${U[locale].h}`;
}

/** What the session is: the coach's name for it when it says something, else its type. */
function label(w: ParsedWorkout, locale: NotificationLocale, opts: LineOptions): string {
  const named = nameQualifier(w.name || '', [...DAYS.he, ...DAYS.en]);
  const base = named || TYPE[locale][classifyWorkout(w)];
  return opts.qualityDows?.includes(w.dayOfWeek) && !named ? `⭐ ${base}` : base;
}

/** "Evening, optional: " — only an evening part. The main session's own optional flag is not trusted. */
function partPrefix(w: ParsedWorkout, locale: NotificationLocale): string {
  if (w.partKind === 'morning') return U[locale].morning;
  if (w.partKind === 'evening') return w.optional ? `${U[locale].evening} ${U[locale].optional}` : U[locale].evening;
  return '';
}

/**
 * One session in a few words — `אימון חזרות · 17–19 ק״מ · 75 דק׳`. `short`
 * drops the duration, for the multi-workout lines.
 */
export function workoutLine(w: ParsedWorkout, locale: NotificationLocale, opts: LineOptions = {}, short = false): string {
  const own = opts.lines?.[slotKey(w)]?.trim();
  if (own) return own;
  const km = kmText(w, locale);
  const dur = short && km ? '' : durationText(num(w.expectedDurationSec), locale);
  // In a list of workouts "·" separates the workouts, so one workout's own parts take a space.
  return [label(w, locale, opts), km, dur].filter(Boolean).join(short ? ' ' : ' · ');
}

const clip = (s: string) => (s.length > MAX_BODY ? `${s.slice(0, MAX_BODY - 1).trimEnd()}…` : s);

export interface WatchPushContext extends LineOptions {
  /** The plan week's Sunday, so "tomorrow" can be said. */
  weekStartDate?: string;
  /** Today in Israel (YYYY-MM-DD). */
  today?: string;
}

function dateOf(weekStart: string, dow: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dow);
  return d.toISOString().slice(0, 10);
}

/** "היום" / "מחר" / the day's name. */
function whenWord(dow: number, locale: NotificationLocale, ctx: WatchPushContext): string {
  if (ctx.weekStartDate && ctx.today) {
    const date = dateOf(ctx.weekStartDate, dow);
    if (date === ctx.today) return U[locale].today;
    if (date === dateOf(ctx.today, 1)) return U[locale].tomorrow;
  }
  return DAYS[locale][dow];
}

/** The push after a delivery Garmin confirmed (or an Apple week queued): which workouts, by name. */
export function watchSentCopy(locale: NotificationLocale, workouts: ParsedWorkout[], ctx: WatchPushContext = {}): PushCopy {
  const ws = [...workouts].sort((a, b) => a.dayOfWeek - b.dayOfWeek || (a.partIndex ?? 1) - (b.partIndex ?? 1));
  const he = locale === 'he';
  const n = ws.length;
  const days = [...new Set(ws.map((w) => w.dayOfWeek))];

  if (n === 0) {
    return he ? { title: '⌚ האימונים נשלחו לשעון', body: 'לחצו לצפייה בתוכנית' } : { title: '⌚ Workouts sent to your watch', body: 'Tap to see the plan' };
  }

  if (n === 1) {
    const d = DAYS[locale][ws[0].dayOfWeek];
    return {
      title: he ? `⌚ אימון יום ${d} נשלח לשעון` : `⌚ ${d}'s workout sent to your watch`,
      body: clip(workoutLine(ws[0], locale, ctx)),
    };
  }

  if (days.length === 1) {
    const d = DAYS[locale][days[0]];
    return {
      title: he ? `⌚ ${n} אימוני יום ${d} נשלחו לשעון` : `⌚ ${n} ${d} workouts sent to your watch`,
      body: clip(ws.map((w) => [partPrefix(w, locale), workoutLine(w, locale, ctx, true)].filter(Boolean).join(': ')).join(' · ')),
    };
  }

  if (n <= 3) {
    return {
      title: he ? `⌚ ${n} אימונים נשלחו לשעון` : `⌚ ${n} workouts sent to your watch`,
      body: clip(ws.map((w) => {
        const part = w.partKind === 'evening' ? ` ${partPrefix(w, locale)}` : '';
        return `${DAYS[locale][w.dayOfWeek]}${part}: ${workoutLine(w, locale, ctx, true)}`;
      }).join(' · ')),
    };
  }

  // Four or more: the week's total and what comes first. Optional evenings are not in the total.
  const counted = ws.filter((w) => !(w.partKind === 'evening' && w.optional));
  let lo = 0, hi = 0, any = false;
  for (const w of counted) {
    const a = num(w.distanceMinKm), b = num(w.distanceMaxKm);
    if (a === null && b === null) continue;
    any = true;
    lo += a ?? b!;
    hi += b ?? a!;
  }
  const total = any ? `${U[locale].total} ${Math.round(lo) === Math.round(hi) ? Math.round(hi) : `${Math.round(lo)}–${Math.round(hi)}`} ${U[locale].km}` : '';
  const first = ws[0];
  const firstLine = `${whenWord(first.dayOfWeek, locale, ctx)}: ${workoutLine(first, locale, ctx, true)}`;
  const wholeWeek = days.length === 7;
  return {
    title: he
      ? (wholeWeek ? `⌚ ${n} אימוני השבוע נשלחו לשעון` : `⌚ ${n} אימונים נשלחו לשעון`)
      : (wholeWeek ? `⌚ This week's ${n} workouts sent to your watch` : `⌚ ${n} workouts sent to your watch`),
    body: clip([total, firstLine].filter(Boolean).join(' · ')),
  };
}

/** Apple only: the iPhone confirmed the workout is scheduled on the watch. */
export function watchOnWatchCopy(locale: NotificationLocale, dows: number[]): PushCopy {
  const days = [...new Set(dows)].sort();
  const he = locale === 'he';
  if (days.length === 1) {
    const d = DAYS[locale][days[0]];
    return he
      ? { title: `✅ אימון יום ${d} נכנס לשעון`, body: 'מחכה לך באפליקציית Workout בשעון' }
      : { title: `✅ ${d}'s workout is on your watch`, body: 'It is waiting in the Workout app on your watch' };
  }
  return he
    ? { title: `✅ ${days.length} אימונים נכנסו לשעון`, body: `${days.map((d) => DAYS.he[d]).join(', ')} · מחכים לך באפליקציית Workout` }
    : { title: `✅ ${days.length} workouts are on your watch`, body: `${days.map((d) => DAYS.en[d]).join(', ')} · waiting in the Workout app` };
}
