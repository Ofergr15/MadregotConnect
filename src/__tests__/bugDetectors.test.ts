import { describe, expect, it } from 'vitest';
import {
  detectDuplicateAthlete, detectGarminSilent, detectParseGap, detectPhantomActivity,
  detectPushOrphan, keepProvable,
  type ActivityRow, type AthleteNameRow, type PlanRow, type ProviderAthlete,
  type PushSubscriptionRow,
} from '@/lib/bugs/detectors';

/**
 * The detectors, pinned against the shape that produced the real failure.
 *
 * Half of these tests are about the detector staying QUIET. That is the point:
 * the damage a noisy detector does is not the alerts, it is that you stop
 * believing the correct ones too — so "the whole club was on holiday" and "push
 * is down for everyone" have to come out as silence, not as findings.
 */

const NOW = new Date('2026-09-20T03:12:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const athlete = (over: Partial<ProviderAthlete> = {}): ProviderAthlete => ({
  id: 'a', name: 'Dana Levi', lastActivityAt: daysAgo(1),
  garminConnected: true, stravaConnected: false, ...over,
});

describe('garmin went silent', () => {
  const syncing = [
    athlete({ id: 's1', lastActivityAt: daysAgo(1) }),
    athlete({ id: 's2', lastActivityAt: daysAgo(2) }),
    athlete({ id: 's3', lastActivityAt: daysAgo(0) }),
  ];

  it('finds the connected athletes whose runs stopped arriving', () => {
    const f = detectGarminSilent([...syncing, athlete({ id: 'x', lastActivityAt: daysAgo(11) })], NOW);
    expect(f?.affected).toBe(1);
    expect(f?.evidence.athleteIds).toEqual(['x']);
    expect(f?.title).toContain('11');
  });

  it('stays quiet when the whole club is quiet — a taper is not a broken token', () => {
    const quiet = [
      athlete({ id: 'a1', lastActivityAt: daysAgo(12) }),
      athlete({ id: 'a2', lastActivityAt: daysAgo(14) }),
      athlete({ id: 'a3', lastActivityAt: daysAgo(20) }),
    ];
    expect(detectGarminSilent(quiet, NOW)).toBeNull();
  });

  it('ignores an athlete who never connected Garmin at all', () => {
    const f = detectGarminSilent(
      [...syncing, athlete({ id: 'n', lastActivityAt: daysAgo(40), garminConnected: false })],
      NOW,
    );
    expect(f).toBeNull();
  });

  it('counts someone who has never synced once, rather than skipping them', () => {
    const f = detectGarminSilent([...syncing, athlete({ id: 'never', lastActivityAt: null })], NOW);
    expect(f?.evidence.athleteIds).toEqual(['never']);
  });

  it('says what it does not know when the athlete is on Strava too', () => {
    const f = detectGarminSilent(
      [...syncing, athlete({ id: 'x', lastActivityAt: daysAgo(11), stravaConnected: true })],
      NOW,
    );
    expect(f?.evidence.unknown).toBeTruthy();
  });

  it('keys on the people, not on the day count, so tonight updates last night', () => {
    const a = detectGarminSilent([...syncing, athlete({ id: 'x', lastActivityAt: daysAgo(11) })], NOW);
    const b = detectGarminSilent(
      [...syncing, athlete({ id: 'x', lastActivityAt: daysAgo(11) })],
      NOW + 86_400_000,
    );
    expect(a?.key).toBe(b?.key);
  });
});

describe('push endpoints that never delivered', () => {
  const sub = (over: Partial<PushSubscriptionRow> = {}): PushSubscriptionRow => ({
    id: 'p', athlete_id: 'a', created_at: daysAgo(60), last_success_at: daysAgo(1), ...over,
  });

  it('finds an old subscription that has never once succeeded', () => {
    const f = detectPushOrphan([sub({ id: 'ok' }), sub({ id: 'ok2' }), sub({ id: 'ok3' }),
      sub({ id: 'dead', athlete_id: 'b', last_success_at: null })], NOW);
    expect(f?.affected).toBe(1);
    expect(f?.evidence.athleteIds).toEqual(['b']);
  });

  it('stays quiet when NOTHING is succeeding — that is an outage, not an orphan', () => {
    const f = detectPushOrphan([
      sub({ id: 'a', last_success_at: null }),
      sub({ id: 'b', last_success_at: null }),
    ], NOW);
    expect(f).toBeNull();
  });

  it('gives a brand-new subscription time to succeed before judging it', () => {
    const f = detectPushOrphan([sub({ id: 'ok' }), sub({ id: 'ok2' }),
      sub({ id: 'fresh', created_at: daysAgo(2), last_success_at: null })], NOW);
    expect(f).toBeNull();
  });

  it('counts people, not rows, when one athlete has two dead endpoints', () => {
    const f = detectPushOrphan([sub({ id: 'ok' }), sub({ id: 'ok2' }),
      sub({ id: 'd1', athlete_id: 'b', last_success_at: null }),
      sub({ id: 'd2', athlete_id: 'b', last_success_at: null })], NOW);
    expect(f?.affected).toBe(1);
    expect(f?.evidence.facts['רשומות מיותמות']).toBe(2);
  });
});

describe('a plan that came out thinner than its siblings', () => {
  const plan = (id: string, count: number, week = '2026-09-13'): PlanRow =>
    ({ id, athlete_id: `ath-${id}`, week_start_date: week, workoutCount: count });

  it('finds the plan with half the workouts of the others that week', () => {
    const f = detectParseGap([plan('a', 6), plan('b', 6), plan('c', 6), plan('d', 2)]);
    expect(f?.affected).toBe(1);
    expect(f?.title).toContain('2');
  });

  it('will not judge a week with only two plans in it', () => {
    expect(detectParseGap([plan('a', 6), plan('b', 2)])).toBeNull();
  });

  it('will not judge a week that is light for everybody', () => {
    // A median of 2 makes "half of it" meaningless; a rest week is not a bug.
    expect(detectParseGap([plan('a', 2), plan('b', 2), plan('c', 1)])).toBeNull();
  });

  it('compares within a week, never across weeks', () => {
    const rows = [
      plan('a', 6), plan('b', 6), plan('c', 6),
      plan('d', 3, '2026-09-06'), plan('e', 3, '2026-09-06'), plan('f', 3, '2026-09-06'),
    ];
    expect(detectParseGap(rows)).toBeNull();
  });
});

describe('one person in two rows', () => {
  const row = (id: string, name: string | null, synthetic = false): AthleteNameRow =>
    ({ id, name, synthetic });

  it('finds the split caused by a Strava login', () => {
    const f = detectDuplicateAthlete([row('1', 'Dana Levi'), row('2', 'Dana Levi', true)]);
    expect(f?.affected).toBe(1);
    expect(f?.evidence.athleteIds).toEqual(['1', '2']);
  });

  it('ignores a genuine namesake when neither row came from Strava', () => {
    expect(detectDuplicateAthlete([row('1', 'Dana Levi'), row('2', 'Dana Levi')])).toBeNull();
  });

  it('matches on spacing and case, which is how the duplicates actually differ', () => {
    const f = detectDuplicateAthlete([row('1', 'dana  levi'), row('2', 'Dana Levi', true)]);
    expect(f?.affected).toBe(1);
  });

  it('does not group every nameless row together', () => {
    expect(detectDuplicateAthlete([row('1', null), row('2', '', true)])).toBeNull();
  });
});

describe('phantom activities', () => {
  const act = (over: Partial<ActivityRow> = {}): ActivityRow => ({
    id: 'x', athlete_id: 'a', start_time: daysAgo(1), duration: 3600,
    distance: 10000, has_polyline: true, source: 'strava', ...over,
  });

  it('finds the empty row that once flooded everybody with notifications', () => {
    const f = detectPhantomActivity([act(), act({ id: 'ghost', duration: null, distance: null, has_polyline: false })]);
    expect(f?.affected).toBe(1);
  });

  it('leaves a treadmill run alone — no GPS is normal, no anything is not', () => {
    expect(detectPhantomActivity([act({ has_polyline: false })])).toBeNull();
  });

  it('leaves a walk with distance but no route alone', () => {
    expect(detectPhantomActivity([act({ has_polyline: false, duration: null })])).toBeNull();
  });
});

describe('proof or silence', () => {
  const f = (affected: number): Parameters<typeof keepProvable>[0][number] => ({
    detector: 'garmin_silent', key: `k${affected}`, title: 't', affected,
    strength: 'finding', evidence: { how: 'h', athleteIds: [], facts: {} },
  });

  it('demotes anything that cannot name a single affected person', () => {
    expect(keepProvable([f(0)])[0].strength).toBe('weak');
  });

  it('puts every real finding above every weak signal', () => {
    const out = keepProvable([f(0), f(1), null, f(7)]);
    expect(out.map(x => x.affected)).toEqual([7, 1, 0]);
  });

  it('drops the nulls without leaving holes in the list', () => {
    expect(keepProvable([null, null])).toEqual([]);
  });
});
