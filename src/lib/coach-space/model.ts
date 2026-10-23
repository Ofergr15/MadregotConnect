// The coach space (mockup ~/.cache/madregot/mockups/staff-ia/full.html, "יאיר · אימונים"):
// four tabs — היום · השבוע · רצים · תובנות. Pure helpers only; every number on those
// screens is derived here from answers the app's existing staff routes already give
// (/api/admin/people, /api/coach/volume, /api/coach/pulse, /api/workout-feedback?list=1,
// /api/week-setup, /api/plans/watch-status, /api/attendance). Nothing here reads the DB.

import { resolveGroup } from '@/lib/utils';
import { isWaiting, type FeedbackLike } from '@/lib/feedback/waiting';

/** The parts of /api/admin/people's Person the coach screens read. */
export interface CoachPerson {
  id: string;
  name: string;
  role?: string | null;
  groupName: string | null;
  status: string;
  approved: boolean;
  source: 'garmin' | 'strava' | null;
  lastRunDay: string | null;
  lastSeenAt: string | null;
  avatarUrl?: string | null;
  isAcademy?: boolean;
}

/** One row of /api/coach/volume. */
export interface VolumeRow {
  athleteId: string;
  name: string;
  squad: string | null;
  series: number[];
  thisWeekKm: number;
  thisWeekRuns: number;
  avgKm: number;
  peakKm: number;
}

export type PackKey = 'A' | 'B' | 'C' | null;
const PACK_KEYS: PackKey[] = ['A', 'B', 'C'];

/** "SUB 2:30" / "Group A" / "Group 1" → A; anything else → null. */
export function packOf(groupName: string | null | undefined): PackKey {
  const i = resolveGroup(groupName).index;
  return i >= 0 ? PACK_KEYS[i] : null;
}

export const PACK_TITLE: Record<Exclude<PackKey, null>, string> = { A: 'A · 2:30', B: 'B · 2:35', C: 'C · 2:45' };

/** "A · 2:30" — the mockup's short pack label. */
export function packLabel(groupName: string | null | undefined): string | null {
  const k = packOf(groupName);
  return k ? PACK_TITLE[k] : groupName || null;
}

/** Who the coach space is about: approved, active members (no staff-only accounts). */
export function roster(people: CoachPerson[]): CoachPerson[] {
  return people.filter((p) => p.approved && p.status === 'active' && p.role !== 'admin');
}

export function ranOn(p: CoachPerson, day: string): boolean {
  return p.lastRunDay === day;
}

/** היום: who ran today and who has not yet, roster order kept. */
export function todaySplit(people: CoachPerson[], today: string): { ran: CoachPerson[]; notYet: CoachPerson[] } {
  const r = roster(people);
  return { ran: r.filter((p) => ranOn(p, today)), notYet: r.filter((p) => !ranOn(p, today)) };
}

/** km this week by pack, from the volume rows. Packs with nobody are left out. */
export function kmByPack(rows: VolumeRow[]): Array<{ pack: Exclude<PackKey, null>; km: number; runners: number }> {
  const out = PACK_KEYS.map((pack) => {
    const mine = rows.filter((r) => packOf(r.squad) === pack);
    return {
      pack: pack as Exclude<PackKey, null>,
      km: Math.round(mine.reduce((s, r) => s + r.thisWeekKm, 0)),
      runners: mine.filter((r) => r.thisWeekRuns > 0).length,
    };
  });
  return out.filter((p) => p.runners > 0 || p.km > 0);
}

/** km per pack per week (the insights chart), in the volume axis order. */
export function packSeries(rows: VolumeRow[], weeks: number): Record<Exclude<PackKey, null>, number[]> {
  const blank = () => Array.from({ length: weeks }, () => 0);
  const out = { A: blank(), B: blank(), C: blank() };
  for (const r of rows) {
    const k = packOf(r.squad);
    if (!k) continue;
    r.series.forEach((v, i) => { if (i < weeks) out[k][i] = Math.round((out[k][i] + v) * 10) / 10; });
  }
  return out;
}

/** עוד לא רצו השבוע: on the roster, nothing this week; with last week's km for context. */
export function notRunThisWeek(people: CoachPerson[], rows: VolumeRow[]): Array<{ person: CoachPerson; lastWeekKm: number | null }> {
  const byId = new Map(rows.map((r) => [r.athleteId, r]));
  return roster(people)
    .filter((p) => (byId.get(p.id)?.thisWeekRuns ?? 0) === 0)
    .map((p) => {
      const s = byId.get(p.id)?.series;
      return { person: p, lastWeekKm: s && s.length >= 2 ? s[s.length - 2] : null };
    });
}

export type RunnerFilter = 'all' | 'A' | 'B' | 'C' | 'notRun' | 'pain' | 'noWatch';

export interface RunnerRow {
  person: CoachPerson;
  pack: PackKey;
  thisWeekKm: number;
  lastWeekKm: number;
  ranThisWeek: boolean;
  pain: boolean;
  noWatch: boolean;
}

export function runnerRows(people: CoachPerson[], rows: VolumeRow[], painIds: Set<string>): RunnerRow[] {
  const byId = new Map(rows.map((r) => [r.athleteId, r]));
  return roster(people)
    .map((p) => {
      const v = byId.get(p.id);
      const s = v?.series ?? [];
      return {
        person: p,
        pack: packOf(p.groupName),
        thisWeekKm: v?.thisWeekKm ?? 0,
        lastWeekKm: s.length >= 2 ? s[s.length - 2] : 0,
        ranThisWeek: (v?.thisWeekRuns ?? 0) > 0,
        pain: painIds.has(p.id),
        noWatch: !p.source,
      };
    })
    .sort((a, b) => b.thisWeekKm - a.thisWeekKm || b.lastWeekKm - a.lastWeekKm || a.person.name.localeCompare(b.person.name));
}

export function matchesFilter(r: RunnerRow, f: RunnerFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'A': case 'B': case 'C': return r.pack === f;
    case 'notRun': return !r.ranThisWeek;
    case 'pain': return r.pain;
    case 'noWatch': return r.noWatch;
  }
}

export function filterCounts(rows: RunnerRow[]): Record<RunnerFilter, number> {
  const keys: RunnerFilter[] = ['all', 'A', 'B', 'C', 'notRun', 'pain', 'noWatch'];
  return Object.fromEntries(keys.map((k) => [k, rows.filter((r) => matchesFilter(r, k)).length])) as Record<RunnerFilter, number>;
}

/** A row of /api/workout-feedback?list=1, as the coach space reads it. */
export interface FeedbackItem extends FeedbackLike {
  name: string;
  avatarUrl?: string | null;
  squad?: string | null;
  difficulty?: number | null;
  feel?: number | string | null;
  activityName?: string | null;
  distance?: number | null;
  startTime?: string | null;
}

/** Feedback waiting for an answer, oldest ask first (lib/feedback/waiting is the rule). */
export function waitingFeedback(items: FeedbackItem[]): FeedbackItem[] {
  return items.filter(isWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How many times this runner asked for feedback in the list (the mockup's "ביקש משוב 6 פעמים"). */
export function askCount(items: FeedbackItem[], athleteId: string): number {
  return items.filter((i) => i.athleteId === athleteId && i.wantsFeedback === true).length;
}

/** The mockup's quick replies under a waiting feedback. */
export const QUICK_REPLIES = ['💪 כל הכבוד', 'תנוח מחר', 'בוא נדבר על זה'] as const;

/** One cell of PlanWatchStatus.runners[].days. */
export type WatchCell = 'ok' | 'sending' | 'waiting' | 'failed' | 'none';

/** How many watches got each day (Sunday → Saturday). */
export function watchCountsByDay(runners: Array<{ days: WatchCell[] }>): number[] {
  return Array.from({ length: 7 }, (_, d) => runners.filter((r) => r.days[d] === 'ok').length);
}

export type DayPublish = 'published' | 'draft' | 'none' | 'rest';

/** A day's state on השבוע: in the plan and the plan was sent, in a draft, or nothing planned. */
export function dayPublish(planStatus: 'none' | 'draft' | 'partial' | 'pushed', planDays: number[], dayOfWeek: number, hasSessions: boolean, watchOk: number): DayPublish {
  const inPlan = planDays.includes(dayOfWeek) || hasSessions;
  if (!inPlan) return planStatus === 'none' ? 'none' : 'rest';
  if (planStatus === 'pushed' || watchOk > 0) return 'published';
  if (planStatus === 'none') return 'none';
  return 'draft';
}

export const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const HE_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "9.10" from an ISO date or timestamp. */
export function shortDay(iso: string): string {
  const d = iso.slice(0, 10);
  return `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
}
