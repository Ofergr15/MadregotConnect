import type { StoryFeature, StoryState } from './gate';
import type { Placement } from './instances';

// Content › stories (mockup ~/.cache/madregot/stories-area/mockup.html v5, Ofer 10-20).
// The pure half: what the hub's "this week" sections hold, and what a birthday row says.
// Nothing here reads the DB — the components feed it the routes' answers.

export type WeekSection = 'air' | 'scheduled' | 'testing';
export interface WeekRow { key: string; section: WeekSection; emoji: string; title: string; sub: string; href: string; logo?: boolean }

/** What /api/admin/celebrations lists (components/content/use-hub LiveRow), the parts used here. */
export interface LiveLike { id: string; source: 'feed' | 'club' | 'survey' | 'scheduled'; emoji: string; title: string; until: string; active: boolean; answers?: number; at?: string }
/** One /api/admin/stories/upcoming row, the parts used here. */
export interface UpcomingLike { athleteId: string; name: string | null; period: string; bucket: string; status: string; publishAt: string }
export interface FeatureLike { feature: StoryFeature; state: StoryState; generate_at?: string | null }

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
/** "היום" / "מחר" / "ה׳" — a day this week, as the rows say it. */
export function dayWord(day: string, today: string): string {
  if (day === today) return 'היום';
  const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (day === t.toISOString().slice(0, 10)) return 'מחר';
  return DOW[new Date(`${day}T12:00:00Z`).getUTCDay()];
}
/** "ה׳ 23.10" */
export const shortDate = (day: string) => `${DOW[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}`;

const first = (name: string | null) => (name || '').trim().split(/\s+/)[0] || 'חבר/ה';

/**
 * The hub's top: everything on air now, scheduled this week, or in testing — every kind
 * together. An empty section is simply absent (Ofer: "if there's no update, nothing there").
 */
export function weekSections(
  live: LiveLike[], birthdays: UpcomingLike[], features: FeatureLike[], today: string,
): Record<WeekSection, WeekRow[]> {
  const out: Record<WeekSection, WeekRow[]> = { air: [], scheduled: [], testing: [] };
  for (const r of live) {
    if (r.source === 'scheduled') {
      if (r.at) out.scheduled.push({ key: `s:${r.id}`, section: 'scheduled', emoji: r.emoji, title: r.title, sub: `${dayWord(dayOf(r.at), today)} ${clock(r.at)}`, href: '/dashboard/content/messages' });
      continue;
    }
    if (!r.active) continue;
    const href = r.source === 'club' ? '/dashboard/content/circle' : r.source === 'survey' ? '/dashboard/content/surveys' : '/dashboard/content/cheers';
    const sub = r.source === 'survey' ? `${r.answers ?? 0} ענו · נסגר ${dayWord(r.until, today)}` : `עד ${dayWord(r.until, today)}`;
    out.air.push({ key: `a:${r.source}:${r.id}`, section: 'air', emoji: r.emoji, title: r.title, sub, href, ...(r.source === 'club' ? { logo: true } : {}) });
  }
  // A birthday that will really go out this week (the cron would act on it), not yet up.
  for (const b of birthdays) {
    if (b.status !== 'ready' || b.period < today || b.bucket === 'later') continue;
    if (new Date(b.publishAt).getTime() <= Date.now()) continue;
    out.scheduled.push({
      key: `b:${b.athleteId}:${b.period}`, section: 'scheduled', emoji: '🎂', title: `${first(b.name)} · יום הולדת`,
      sub: `${dayWord(dayOf(b.publishAt), today)} ${clock(b.publishAt)}`, href: birthdayHref(b.athleteId, b.period),
    });
  }
  for (const f of features) {
    if (f.state !== 'testers' && f.state !== 'self') continue;
    out.testing.push({ key: `t:${f.feature}`, section: 'testing', emoji: FEATURE_META[f.feature].emoji, title: FEATURE_META[f.feature].title, sub: f.state === 'self' ? 'רק אני' : 'לבודקים בלבד', href: FEATURE_META[f.feature].href });
  }
  return out;
}

/** The order on the hub (gate.ts's STORY_FEATURES is server-side). */
export const FEATURE_ORDER: StoryFeature[] = ['birthday', 'weekly', 'annual'];

export const FEATURE_META: Record<StoryFeature, { emoji: string; title: string; href: string }> = {
  birthday: { emoji: '🎂', title: 'יום הולדת', href: '/dashboard/birthdays' },
  weekly: { emoji: '📅', title: 'סיכום שבועי', href: '/dashboard/stories/weekly' },
  annual: { emoji: '🏁', title: 'סיכום שנתי', href: '/dashboard/stories/annual' },
};

export const STATE_TAG: Record<StoryState, { label: string; tone: 'off' | 'test' | 'on' }> = {
  off: { label: 'כבוי', tone: 'off' }, self: { label: 'רק אני', tone: 'test' }, testers: { label: 'בדיקה', tone: 'test' }, all: { label: 'פעיל', tone: 'on' },
};

export const birthdayHref = (athleteId: string, period: string) => `/dashboard/birthdays/${athleteId}?period=${period}`;

/** Ready = the club prepared something: a personal word or at least one photo. */
export function birthdayReady(cfg: { message?: string | null; photos?: Record<string, string> | null } | null | undefined): boolean {
  return !!(cfg?.message?.trim() || Object.keys(cfg?.photos || {}).length);
}

/** How long — the chips, and the manual range. */
export type Duration = 1 | 3 | 7 | 'manual';
export const DURATIONS: Array<[Duration, string]> = [[1, 'יום'], [3, '3 ימים'], [7, 'שבוע'], ['manual', 'עד תאריך…']];
export const PLACEMENT_LABEL: Record<Placement, string> = { feed: 'פוסט בפיד', circle: 'עיגול מדרגות', both: 'שניהם' };

/** The overrides one save sends, from the screen's choices. A manual range sets both ends. */
export function saveBody(c: { placement: Placement; duration: Duration; from: string | null; to: string | null; push: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = { placement: c.placement, send_push: c.push };
  if (c.duration === 'manual') {
    body.publish_at = c.from; body.until_at = c.to; body.display_days = null;
  } else {
    body.display_days = c.duration; body.until_at = null;
  }
  return body;
}

/** The current choice back from the person route's effective values. */
export function durationOf(e: { displayDays: number; manualUntil?: boolean }): Duration {
  if (e.manualUntil) return 'manual';
  return e.displayDays === 1 || e.displayDays === 3 || e.displayDays === 7 ? e.displayDays : 'manual';
}
