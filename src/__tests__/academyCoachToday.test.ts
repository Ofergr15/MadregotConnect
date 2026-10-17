import { describe, expect, it } from 'vitest';
import { buildCoachBoard, type FeedbackRow } from '@/lib/academy/coach-today';
import type { AthleteAdherence, WorkoutAdherenceRow } from '@/lib/academy/report';

// Saturday 17 Oct 2026 — the last day of a Sunday-first plan week.
const TODAY = '2026-10-17';

function row(date: string, completed: boolean, extra: Partial<WorkoutAdherenceRow> = {}): WorkoutAdherenceRow {
  return {
    date,
    name: 'ריצה',
    completed,
    planned: { date, name: 'ריצה', distanceMin: 8000, distanceMax: 10000, durationSec: 3000 },
    actual: completed ? { id: `a-${date}`, date, distance: 9000, duration: 2700, averagePace: 300, averageHr: 150 } : null,
    distance: { status: 'ok', plannedMin: 8000, plannedMax: 10000, actual: completed ? 9000 : null, pct: 1 },
    duration: { status: 'ok', planned: 3000, actual: null, pct: null, estimated: true },
    pace: { status: 'ok', plannedMin: null, plannedMax: null, comparedMin: null, comparedMax: null, actual: null },
    score: completed ? 1 : 0,
    ...extra,
  } as WorkoutAdherenceRow;
}

const athlete = (id: string, name: string, workouts: WorkoutAdherenceRow[]): AthleteAdherence => ({
  athleteId: id,
  name,
  week: { plannedCount: workouts.length, completedCount: workouts.filter((w) => w.completed).length, completionRate: 0, avgScore: 0, workouts },
});

const fb = (over: Partial<FeedbackRow>): FeedbackRow => ({
  athlete_id: 'x', created_at: `${TODAY}T08:00:00Z`, feel: 3, difficulty: 5, pain: false, pain_detail: null,
  wants_feedback: false, comment: null, coach_reply: null, ...over,
});

describe('buildCoachBoard', () => {
  it('puts a trainee who missed in a row first, and says how many', () => {
    const { trainees } = buildCoachBoard({
      today: TODAY,
      reports: [[
        athlete('ok', 'Noa', [row('2026-10-13', true), row('2026-10-15', true), row(TODAY, true)]),
        athlete('gone', 'Raz', [row('2026-10-13', false), row('2026-10-15', false), row(TODAY, false)]),
      ]],
      feedback: [],
    });
    expect(trainees[0].athleteId).toBe('gone');
    expect(trainees[0].reasons).toContainEqual({ kind: 'missedStreak', count: 3 });
    expect(trainees[0].today.state).toBe('notyet');
    expect(trainees[1].reasons).toEqual([]);
    expect(trainees[1].today.state).toBe('done');
  });

  it('draws the last seven days with rest days grey and today last', () => {
    const { trainees } = buildCoachBoard({
      today: TODAY,
      reports: [[athlete('a', 'A', [row('2026-10-12', true), row('2026-10-14', false)])]],
      feedback: [],
    });
    const strip = trainees[0].strip;
    expect(strip).toHaveLength(7);
    expect(strip[6].date).toBe(TODAY);
    expect(strip.find((d) => d.date === '2026-10-12')?.state).toBe('done');
    expect(strip.find((d) => d.date === '2026-10-14')?.state).toBe('missed');
    expect(strip.find((d) => d.date === '2026-10-13')?.state).toBe('rest');
  });

  it('flags recent pain and an unanswered request, not an answered one', () => {
    const { trainees } = buildCoachBoard({
      today: TODAY,
      reports: [[athlete('y', 'Yoav', [row(TODAY, true)]), athlete('n', 'Noa', [row(TODAY, true)])]],
      feedback: [
        fb({ athlete_id: 'y', pain: true, pain_detail: 'ברך' }),
        fb({ athlete_id: 'n', wants_feedback: true, coach_reply: 'כל הכבוד' }),
      ],
    });
    const yoav = trainees.find((t) => t.athleteId === 'y')!;
    expect(yoav.reasons).toContainEqual({ kind: 'pain', detail: 'ברך', level: 5 });
    expect(trainees.find((t) => t.athleteId === 'n')!.reasons).toEqual([]);
  });

  it("counts this plan week's km, done against planned", () => {
    const { trainees } = buildCoachBoard({
      today: TODAY,
      reports: [[athlete('a', 'A', [row('2026-10-11', true), row('2026-10-14', false), row('2026-10-04', true)])]],
      feedback: [],
    });
    expect(trainees[0].weekKm).toEqual({ done: 9, planned: 18 });
  });

  it('lists recent runs and feedback, newest first', () => {
    const { events } = buildCoachBoard({
      today: TODAY,
      reports: [[athlete('a', 'A', [row('2026-10-15', true), row(TODAY, true)])]],
      feedback: [fb({ athlete_id: 'a', pain: true, created_at: `${TODAY}T09:00:00Z` })],
    });
    expect(events[0].kind).toBe('pain');
    expect(events.filter((e) => e.kind === 'run')).toHaveLength(2);
  });
});
