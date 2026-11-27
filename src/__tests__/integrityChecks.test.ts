import { describe, expect, it } from 'vitest';
import {
  duplicateTwins, impossibleActivities, impossiblePlanDates, orphanRows, summarize, type ActivityRow,
} from '@/lib/integrity/checks';

const NOW = new Date('2026-11-27T12:00:00Z');
const act = (o: Partial<ActivityRow> & { id: string }): ActivityRow => ({
  athlete_id: 'a1', source: 'garmin', start_time: '2026-11-20T06:00:00Z', distance: 10000, duration: 3000, ...o,
});

describe('orphanRows', () => {
  const ids = new Set(['a1']);
  it('flags a missing athlete and a null one unless nullable', () => {
    const rows = [{ id: 'r1', athlete_id: 'a1' }, { id: 'r2', athlete_id: 'ghost' }, { id: 'r3', athlete_id: null }];
    expect(orphanRows('t', rows, ids).map((f) => f.id)).toEqual(['r2', 'r3']);
    expect(orphanRows('t', rows, ids, { nullable: true }).map((f) => f.id)).toEqual(['r2']);
  });
});

describe('duplicateTwins', () => {
  it('flags a Garmin+Strava pair of one run', () => {
    const f = duplicateTwins([act({ id: 'g' }), act({ id: 's', source: 'strava', start_time: '2026-11-20T06:00:05Z', distance: 10050 })]);
    expect(f).toEqual([expect.objectContaining({ id: 'g', detail: 'strava twin s' })]);
  });
  it('does not flag sequential reps, other athletes, or same-source rows', () => {
    const reps = [
      act({ id: 'g1', distance: 2000, duration: 430 }),
      act({ id: 's2', source: 'strava', start_time: '2026-11-20T06:09:30Z', distance: 2010, duration: 430 }),
      act({ id: 's3', source: 'strava', athlete_id: 'a2' }),
      act({ id: 'g4', start_time: '2026-11-20T06:00:01Z' }),
    ];
    expect(duplicateTwins(reps)).toEqual([]);
  });
});

describe('impossiblePlanDates', () => {
  it('accepts a Sunday plan with valid days', () => {
    expect(impossiblePlanDates([{ id: 'p', week_start_date: '2026-11-22', athlete_id: null, parsed_workouts: [{ dayOfWeek: 0 }, { dayOfWeek: 6 }] }], NOW)).toEqual([]);
  });
  it('flags Monday anchors, fake days, out of range and bad dayOfWeek', () => {
    const f = impossiblePlanDates([
      { id: 'mon', week_start_date: '2026-11-23', athlete_id: null },
      { id: 'feb30', week_start_date: '2026-02-30', athlete_id: null },
      { id: 'junk', week_start_date: 'soon', athlete_id: null },
      { id: 'old', week_start_date: '2019-01-06', athlete_id: null },
      { id: 'dow', week_start_date: '2026-11-22', athlete_id: null, parsed_workouts: [{ dayOfWeek: 7 }, { dayOfWeek: 1.5 }] },
    ], NOW);
    expect(f.map((x) => x.id)).toEqual(['mon', 'feb30', 'junk', 'old', 'dow', 'dow']);
  });
});

describe('impossibleActivities', () => {
  it('flags future, negative, unparsable and superhuman rows only', () => {
    const f = impossibleActivities([
      act({ id: 'ok' }),
      act({ id: 'future', start_time: '2026-12-25T06:00:00Z' }),
      act({ id: 'neg', distance: -5 }),
      act({ id: 'bad', start_time: 'x' }),
      act({ id: 'fast', distance: 10000, duration: 600 }),
    ], NOW);
    expect(f.map((x) => x.id)).toEqual(['future', 'neg', 'bad', 'fast']);
    expect(summarize(f)).toEqual({ 'impossible-activity:athlete_activities': 4 });
  });
});

describe('the script only reads', () => {
  it('has no insert/update/delete/upsert/rpc call', async () => {
    const fs = await import('node:fs');
    for (const p of ['scripts/integrity-check.mts', 'src/lib/integrity/checks.ts']) {
      expect(fs.readFileSync(p, 'utf8')).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
  });
});
