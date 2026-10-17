/**
 * The academy coach's Management page — "today, by trainee" (mockup ~/.cache/madregot/attendance-nav/
 * academy-coach.html, approved 2026-10-17): every trainee at a glance, so a coach
 * never has to open one to learn that something is wrong.
 *
 * Pure: the route (GET /api/academy/coach-today) loads the week reports and the
 * feedback rows and hands them here. Everything is per TRAINEE, sorted so the ones
 * that need the coach come first.
 */

import type { AthleteAdherence, WorkoutAdherenceRow } from './report';
import { addDaysToDateStr, planWeekStartOf } from '@/lib/utils';

export type DayState = 'done' | 'missed' | 'rest' | 'upcoming' | 'today';

export interface BoardToday {
  name: string;
  /** Planned distance, metres (mid-point of the plan's range). */
  plannedM: number;
  paceMin: number | null;
  paceMax: number | null;
  state: 'done' | 'notyet' | 'missed' | 'rest';
  actual: { distanceM: number; durationSec: number; pace: number | null; hr: number | null } | null;
  /** Plan-vs-execution accuracy 0..100, when graded. */
  score: number | null;
  direction: string | null;
}

export type Reason =
  | { kind: 'missedStreak'; count: number }
  | { kind: 'pain'; detail: string | null; level: number | null }
  | { kind: 'wantsReply'; comment: string | null }
  | { kind: 'offPlan'; direction: string; score: number | null };

export interface BoardTrainee {
  athleteId: string;
  name: string;
  today: BoardToday;
  tomorrow: { name: string; plannedM: number } | null;
  /** The last seven days, oldest first, today last. */
  strip: Array<{ date: string; state: DayState }>;
  weekKm: { done: number; planned: number };
  lastFeel: { feel: number | null; difficulty: number | null } | null;
  reasons: Reason[];
}

export interface BoardEvent {
  athleteId: string;
  name: string;
  at: string; // ISO or YYYY-MM-DD
  kind: 'run' | 'pain' | 'reply' | 'feedback';
  text: string | null;
  score?: number | null;
}

export interface FeedbackRow {
  athlete_id: string;
  created_at: string;
  feel: number | null;
  difficulty: number | null;
  pain: boolean | null;
  pain_detail: string | null;
  wants_feedback: boolean | null;
  comment: string | null;
  coach_reply: string | null;
}

const mid = (w: { planned: { distanceMin: number; distanceMax: number } }) =>
  Math.round((w.planned.distanceMin + w.planned.distanceMax) / 2);

const isPlanned = (w: WorkoutAdherenceRow) => !w.planned.optional;

/** A score this low on a run that drifted is worth a coach's eye. */
const OFF_PLAN_SCORE = 70;
const OFF_PLAN_DIRECTIONS = new Set(['too_fast', 'too_slow', 'mixed']);
const PAIN_RECENT_DAYS = 3;

export function buildCoachBoard(input: {
  today: string;
  /** This week's and last week's reports (and next week's, for "tomorrow" on a Saturday). */
  reports: AthleteAdherence[][];
  feedback: FeedbackRow[];
}): { trainees: BoardTrainee[]; events: BoardEvent[] } {
  const { today } = input;
  const tomorrow = addDaysToDateStr(today, 1);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(today, i - 6));

  // Every planned workout of every trainee, by athlete, across the weeks given.
  const byAthlete = new Map<string, { name: string; rows: WorkoutAdherenceRow[] }>();
  input.reports.forEach((report) => {
    for (const a of report) {
      const entry = byAthlete.get(a.athleteId) ?? { name: a.name, rows: [] };
      entry.rows.push(...a.week.workouts);
      byAthlete.set(a.athleteId, entry);
    }
  });

  const fbByAthlete = new Map<string, FeedbackRow[]>();
  for (const f of [...input.feedback].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const list = fbByAthlete.get(f.athlete_id) ?? [];
    list.push(f);
    fbByAthlete.set(f.athlete_id, list);
  }

  const trainees: BoardTrainee[] = [];
  const events: BoardEvent[] = [];

  for (const [athleteId, { name, rows }] of byAthlete) {
    const planned = rows.filter(isPlanned);
    const onDay = (d: string) => planned.filter((w) => w.date === d);

    const strip = days.map((d) => {
      const ws = onDay(d);
      if (!ws.length) return { date: d, state: 'rest' as DayState };
      if (ws.every((w) => w.completed)) return { date: d, state: 'done' as DayState };
      if (d === today) return { date: d, state: 'today' as DayState };
      return { date: d, state: (d < today ? 'missed' : 'upcoming') as DayState };
    });

    const todays = onDay(today);
    const main = todays.find((w) => !w.completed) ?? todays[0];
    const todayState: BoardToday['state'] = !main ? 'rest' : main.completed ? 'done' : 'notyet';
    const t: BoardToday = main
      ? {
        name: main.name,
        plannedM: mid(main),
        paceMin: main.planned.paceMin ?? null,
        paceMax: main.planned.paceMax ?? null,
        state: todayState,
        actual: main.actual
          ? {
            distanceM: main.actual.distance,
            durationSec: main.actual.movingDuration || main.actual.duration,
            pace: main.actual.averagePace ?? null,
            hr: main.actual.averageHr ?? null,
          }
          : null,
        score: main.execution?.score ?? null,
        direction: main.execution?.direction ?? null,
      }
      : { name: '', plannedM: 0, paceMin: null, paceMax: null, state: 'rest', actual: null, score: null, direction: null };

    const next = onDay(tomorrow)[0];

    // Missed in a row, counting back from yesterday — rest days don't break a streak.
    let streak = 0;
    for (let i = days.length - 2; i >= 0; i--) {
      const s = strip[i].state;
      if (s === 'rest') continue;
      if (s === 'missed') streak++;
      else break;
    }
    if (todayState === 'notyet' && streak > 0) streak++; // today not done yet extends a live streak

    // This plan week's km — the rows of the week that contains today.
    const weekStart = planWeekStartOf(today);
    const weekEnd = addDaysToDateStr(weekStart, 6);
    const weekRows = planned.filter((w) => w.date >= weekStart && w.date <= weekEnd);
    const weekKm = {
      done: Math.round(weekRows.reduce((s, w) => s + (w.actual?.distance ?? 0), 0) / 100) / 10,
      planned: Math.round(weekRows.reduce((s, w) => s + mid(w), 0) / 100) / 10,
    };

    const fb = fbByAthlete.get(athleteId) ?? [];
    const reasons: Reason[] = [];
    if (streak >= 2) reasons.push({ kind: 'missedStreak', count: streak });
    const pain = fb.find((f) => f.pain && f.created_at.slice(0, 10) >= addDaysToDateStr(today, -PAIN_RECENT_DAYS));
    if (pain) reasons.push({ kind: 'pain', detail: pain.pain_detail, level: pain.difficulty });
    const ask = fb.find((f) => f.wants_feedback && !f.coach_reply);
    if (ask) reasons.push({ kind: 'wantsReply', comment: ask.comment });
    if (t.state === 'done' && t.direction && OFF_PLAN_DIRECTIONS.has(t.direction) && (t.score == null || t.score < OFF_PLAN_SCORE)) {
      reasons.push({ kind: 'offPlan', direction: t.direction, score: t.score });
    }

    trainees.push({
      athleteId,
      name,
      today: t,
      tomorrow: next ? { name: next.name, plannedM: mid(next) } : null,
      strip,
      weekKm,
      lastFeel: fb[0] ? { feel: fb[0].feel, difficulty: fb[0].difficulty } : null,
      reasons,
    });

    for (const w of planned) {
      if (w.completed && w.actual && w.date >= days[0]) {
        events.push({ athleteId, name, at: w.date, kind: 'run', text: w.name, score: w.execution?.score ?? null });
      }
    }
    for (const f of fb) {
      if (f.created_at.slice(0, 10) < days[0]) continue;
      if (f.pain) events.push({ athleteId, name, at: f.created_at, kind: 'pain', text: f.pain_detail });
      else if (f.wants_feedback && !f.coach_reply) events.push({ athleteId, name, at: f.created_at, kind: 'reply', text: f.comment });
      else events.push({ athleteId, name, at: f.created_at, kind: 'feedback', text: f.comment });
    }
  }

  // Attention first (most reasons, then a missed streak), then everyone else by name.
  const weight = (x: BoardTrainee) => x.reasons.length * 10 + (x.reasons.some((r) => r.kind === 'pain') ? 5 : 0)
    + (x.reasons.some((r) => r.kind === 'missedStreak') ? 3 : 0);
  trainees.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name));
  events.sort((a, b) => b.at.localeCompare(a.at));
  return { trainees, events: events.slice(0, 15) };
}
