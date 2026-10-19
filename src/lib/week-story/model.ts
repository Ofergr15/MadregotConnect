/**
 * "השבוע שלך" — the weekly story (mockup ~/.cache/madregot/weekly-summary/weekly-story.html):
 * the plan week, Sunday to Saturday, as short slides like the birthday "השנה שלך". Pure rules
 * here: when it is open, which week, which slides a week earns, and what the push says.
 *
 * Open from Saturday 12:00 to Sunday 20:00, Israel time (Ofer, 2026-10-19) — after the
 * Saturday long run, and long enough for Sunday. The numbers are read when the story opens,
 * so a run later on Saturday is in it.
 */

const DAY_MS = 86_400_000;

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD. */
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export interface StoryWindow { weekStart: string; weekEnd: string }

/**
 * The week the story is about at this Israeli moment, or null outside the window: Saturday
 * from 12:00 (the week that ends today), and Sunday until 20:00 (the week that ended
 * yesterday).
 */
export function storyWindow(today: string, hour: number): StoryWindow | null {
  const wd = weekdayOf(today);
  if (wd === 6 && hour >= 12) return { weekStart: addDays(today, -6), weekEnd: today };
  if (wd === 0 && hour < 20) return { weekStart: addDays(today, -7), weekEnd: addDays(today, -1) };
  return null;
}

/** "18–24.10", or "28.9–4.10" across a month. */
export function weekLabel(w: StoryWindow): string {
  const [, sm, sd] = w.weekStart.split('-').map(Number);
  const [, em, ed] = w.weekEnd.split('-').map(Number);
  return sm === em ? `${sd}–${ed}.${em}` : `${sd}.${sm}–${ed}.${em}`;
}

export interface WeekNumbers {
  km: number;
  runs: number;
  seconds: number;
  /** Per day, Sunday first: km run that day. */
  dayKm: number[];
  lastWeekKm: number | null;
  /** 0..1 of the planned km, null when no plan was published for them. */
  planShare: number | null;
  sessionsDone: number | null;
  sessionsPlanned: number | null;
  /** Records broken this week (key like '10k', and the new time). */
  records: Array<{ label: string; seconds: number; previous: number | null }>;
  /** Their place in their pack by km, and last week's. */
  packRank: { rank: number; of: number; lastRank: number | null } | null;
}

export type Highlight =
  | { kind: 'record'; text: string }
  | { kind: 'fullPlan'; text: string }
  | { kind: 'bigWeek'; text: string }
  | { kind: 'up'; text: string }
  | { kind: 'easy'; text: string };

const fmtKm = (km: number) => (Math.round(km * 10) / 10).toLocaleString('en-US');

/** The one thing that stood out this week, for the push and the opening slide. */
export function highlightOf(n: WeekNumbers, biggestInWeeks = 0): Highlight {
  if (n.records.length) return { kind: 'record', text: `שיא חדש ב־${n.records[0].label}!` };
  if (n.planShare != null && n.planShare >= 0.99) return { kind: 'fullPlan', text: '100% מהתוכנית!' };
  if (biggestInWeeks >= 8) return { kind: 'bigWeek', text: `השבוע הכי גדול שלך ב־${biggestInWeeks} שבועות!` };
  if (n.lastWeekKm != null && n.km - n.lastWeekKm >= 3) return { kind: 'up', text: `${fmtKm(n.km - n.lastWeekKm)} ק״מ יותר משבוע שעבר.` };
  return { kind: 'easy', text: 'כל ק״מ נספר.' };
}

/** The Saturday-noon push (Ofer: from 12:00): the week's line and its highlight. */
export function storyPushCopy(n: WeekNumbers, biggestInWeeks = 0): { title: string; body: string } {
  const parts = [`${fmtKm(n.km)} ק״מ`];
  if (n.planShare != null) parts.push(`${Math.round(n.planShare * 100)}% מהתוכנית`);
  const h = highlightOf(n, biggestInWeeks);
  return { title: 'השבוע שלך מוכן 🏅', body: `${parts.join(' · ')} — ${h.text} לחיצה לסטורי של השבוע.` };
}

export const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
};

/** "5:12" per km, or null. */
export const fmtPace = (sec: number, km: number) => {
  if (!km) return null;
  const p = Math.round(sec / km);
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`;
};

/**
 * The club's week as its own feed post, Saturday at noon beside the stories (Ofer,
 * 2026-10-19: "3 b" — both inside the story and as a post). One per week: the tick keys
 * it on `weekEnd`.
 */
export const CLUB_WEEK_KIND = 'club_week';
export interface ClubWeekPayload { kind: typeof CLUB_WEEK_KIND; weekStart: string; weekEnd: string; km: number; runners: number; records: number; marathons: number }

export function toClubWeek(payload: Record<string, unknown> | null | undefined): ClubWeekPayload | null {
  if (!payload || payload.kind !== CLUB_WEEK_KIND) return null;
  const num = (k: string) => (typeof payload[k] === 'number' ? (payload[k] as number) : 0);
  if (typeof payload.weekEnd !== 'string' || typeof payload.weekStart !== 'string') return null;
  return { kind: CLUB_WEEK_KIND, weekStart: payload.weekStart, weekEnd: payload.weekEnd, km: num('km'), runners: num('runners'), records: num('records'), marathons: num('marathons') };
}

export function clubWeekBody(c: Pick<ClubWeekPayload, 'km' | 'runners' | 'records' | 'marathons'>): string {
  const extra = [
    c.records > 0 && `${c.records} ${c.records === 1 ? 'שיא אישי' : 'שיאים אישיים'}`,
    c.marathons > 0 && `${c.marathons === 1 ? 'ריצה אחת' : `${c.marathons} ריצות`} באורך מרתון 🏁`,
  ].filter(Boolean);
  // No date range in the text: "11–17.10" in a right-to-left line prints as "17.10–11".
  return `השבוע של כל המדרגות: ${c.runners} רצים, ${c.km.toLocaleString('en-US')} ק״מ ביחד${extra.length ? ` ו־${extra.join(' ו־')}` : ''}. שבוע טוב! 💙`;
}

/** The quality screen's verdict on a set (dashboard/quality-session vsTarget): within 1″, or up to 3″ slow, is on target. */
export function qualityVerdict(vs: number): { text: string; ok: boolean } {
  if (Math.abs(vs) < 1 || (vs > 0 && vs <= 3)) return { text: 'ביעד', ok: true };
  return vs < 0 ? { text: `${Math.round(-vs)}″ מהר מהיעד`, ok: true } : { text: `${Math.round(vs)}″ לאט מהיעד`, ok: false };
}
