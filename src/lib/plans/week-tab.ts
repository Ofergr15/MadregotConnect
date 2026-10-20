import { planDayKey, type WeekSession } from './workout-parsing';
import { weekTargetRange, type WeekPlanTotals, type WeekTarget } from './week-target';
import type { PlanWeekRun, PlanWeekStats } from '@/lib/athletes/plan-week';

// ═════════════════════════════════════════════════════════════════════════════
// "השבוע" (my-week-proposal.html, Ofer 10-20) — the plan tab's week, day by day,
// with what was run under each day. Pure, so the ring on the profile and the ring
// on the tab are the SAME numbers (the proposal: "the screens must not disagree on
// a single km"): both read `ringNumbers`, from stats.planWeek + the plan in the
// member's own lane.
// ═════════════════════════════════════════════════════════════════════════════

export interface WeekPlan extends WeekPlanTotals {
  hasClubPlan?: boolean;
  sessions: WeekSession[];
  dailyDistances: Array<{ dayOfWeek: number; requiredMin?: number; min: number; type: string }>;
}

/** A day's prescribed kilometres, optional sessions left out. */
export function plannedMin(plan: WeekPlan | null | undefined, d: number): number {
  const dd = plan?.dailyDistances?.find((x) => x.dayOfWeek === d);
  return dd ? dd.requiredMin ?? dd.min : 0;
}

export interface RingNumbers {
  /** The club week's target range, or null without a published club plan. */
  target: WeekTarget | null;
  /** Where the plan says to be by the end of today. */
  shouldBy: number;
  /** What the ring's full circle stands for. */
  scale: number;
}

export function ringNumbers(pw: PlanWeekStats, plan: WeekPlan | null | undefined): RingNumbers {
  const clubPlan = !!plan?.hasPlan && plan.hasClubPlan !== false;
  const target = clubPlan ? weekTargetRange(plan) : null;
  const shouldBy = Array.from({ length: pw.today + 1 }, (_, d) => plannedMin(plan, d)).reduce((s, x) => s + x, 0);
  // Without a published week the ring is against the athlete's own average.
  const scale = target?.max || Math.max(pw.avgKm, pw.km * 1.25, shouldBy * 1.25, 10);
  return { target, shouldBy, scale };
}

export type DayWhen = 'past' | 'today' | 'tomorrow' | 'later';

export interface WeekDayRow {
  d: number;
  date: string;
  when: DayWhen;
  /** The plan's sessions, prescribed first, then the offered ones ("אופציה"). */
  sessions: WeekSession[];
  /** True when the day has something prescribed (not only optional sessions). */
  prescribed: boolean;
  runs: PlanWeekRun[];
  km: number;
}

export function weekDayRows(pw: PlanWeekStats, plan: WeekPlan | null | undefined): WeekDayRow[] {
  return Array.from({ length: 7 }, (_, d) => {
    const sessions = (plan?.sessions ?? []).filter((s) => s.dayOfWeek === d);
    const ordered = [...sessions.filter((s) => !s.optional), ...sessions.filter((s) => s.optional)];
    const when: DayWhen = d < pw.today ? 'past' : d === pw.today ? 'today' : d === pw.today + 1 ? 'tomorrow' : 'later';
    return {
      d,
      date: planDayKey(pw.weekStart, d),
      when,
      sessions: ordered,
      prescribed: ordered.some((s) => !s.optional),
      runs: pw.dayRuns[d] ?? [],
      km: pw.days[d] ?? 0,
    };
  });
}

/** Types that make a session the week's key one ("האימון המרכזי הבא"). */
const KEY_TYPES = new Set(['intervals', 'tempo', 'fartlek', 'progressive', 'long_run']);

export interface WeekLeft {
  /**
   * Prescribed kilometres still to run: the ring's own floor (target.min) less what is
   * already run — the ring's number, so the two can never disagree. 0 once reached.
   */
  requiredKm: number;
  /** Days still ahead with something prescribed (today counts until it has a run). */
  days: number;
  /** The next key session ahead (quality or long), else the next prescribed one. */
  next: { d: number; session: WeekSession } | null;
  /** Kilometres on offer in optional sessions still ahead, long end. */
  optionalKm: number;
}

export function weekLeft(pw: PlanWeekStats, plan: WeekPlan | null | undefined): WeekLeft | null {
  const { target } = ringNumbers(pw, plan);
  if (!target) return null;
  const rows = weekDayRows(pw, plan);
  const ahead = rows.filter((r) => r.d > pw.today || (r.d === pw.today && r.km <= 0));
  const prescribedAhead = ahead.filter((r) => r.prescribed);
  const sessionsAhead = prescribedAhead.flatMap((r) => r.sessions.filter((s) => !s.optional).map((session) => ({ d: r.d, session })));
  const next = sessionsAhead.find((x) => KEY_TYPES.has(x.session.type)) ?? sessionsAhead[0] ?? null;
  const optionalKm = ahead.flatMap((r) => r.sessions.filter((s) => s.optional)).reduce((s, x) => s + (x.kmMax || 0), 0);
  return {
    requiredKm: Math.max(0, Math.round((target.min - pw.km) * 10) / 10),
    days: prescribedAhead.length,
    next,
    optionalKm: Math.round(optionalKm * 10) / 10,
  };
}

/** Last full plan week's kilometres (the line's second-to-last point), or null. */
export function lastWeekKm(pw: PlanWeekStats): number | null {
  const n = pw.weeks.length;
  return n >= 2 ? pw.weeks[n - 2].km : null;
}
