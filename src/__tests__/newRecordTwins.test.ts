import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findNewRecords, twinGroupIds, personalRecordPayload, personalRecordBody, postPersonalRecordCard, PERSONAL_RECORD_KIND,
} from '@/lib/prs/new-record-alert';
import type { RunActivityRow } from '@/lib/prs/pr-buckets';

// Task 159: a new PR on sync → one push and (flag personal_record_feed, default off) one
// feed card, once per run — where "the run" is the Garmin activity AND its Strava twin.

const h = vi.hoisted(() => ({ flag: false }));
vi.mock('@/lib/features/server', () => ({ isFeatureEnabled: async () => h.flag }));

const NOW = Date.parse('2026-09-23T12:00:00Z');
type Row = RunActivityRow & { source?: string };
const run = (id: string, start: string, seconds: number, source = 'garmin', distance = 5000): Row =>
  ({ id, activity_name: id, activity_type: 'running', start_time: start, distance, duration: seconds, source });
const old = run('march', '2026-03-27T06:00:00Z', 1117);
const garmin = run('g-today', '2026-09-23T05:53:17', 1092, 'garmin');
const strava = run('s-today', '2026-09-23T05:53:17', 1092, 'strava', 5012);

describe('findNewRecords with twins', () => {
  it('the Strava copy at the same time no longer turns a real PR into a tie', () => {
    expect(findNewRecords([old, garmin, strava], { now: NOW })).toEqual([{ activityId: 'g-today', bucket: '5k', seconds: 1092, gainSec: 25 }]);
  });

  it('only the Strava copy synced so far: the PR is still the PR, under its id', () => {
    expect(findNewRecords([old, strava], { now: NOW }).map((r) => r.activityId)).toEqual(['s-today']);
  });

  it('separate reps a few minutes apart are not twins', () => {
    const rep1 = run('rep1', '2026-09-23T05:00:00', 1092);
    const rep2 = run('rep2', '2026-09-23T05:25:00', 1100);
    // rep2 is slower than rep1; with rep1 a real PR, rep2 stays a separate (slower) run.
    expect(findNewRecords([old, rep1, rep2], { now: NOW }).map((r) => r.activityId)).toEqual(['rep1']);
  });
});

describe('twinGroupIds', () => {
  it('the run under every id it has', () => {
    expect(twinGroupIds('g-today', [old, garmin, strava]).sort()).toEqual(['g-today', 's-today']);
    expect(twinGroupIds('march', [old, garmin, strava])).toEqual(['march']);
    expect(twinGroupIds('missing', [old])).toEqual(['missing']);
  });
});

describe('feed card payload', () => {
  it('carries distances and the run, never a time', () => {
    const p = personalRecordPayload('me', 'g-today', [{ bucket: '5k' }, { bucket: '10k' }]);
    expect(p).toEqual({ kind: PERSONAL_RECORD_KIND, athleteId: 'me', activityId: 'g-today', buckets: ['5k', '10k'] });
    expect(JSON.stringify(p)).not.toMatch(/seconds|gain/);
    expect(personalRecordBody(['5k'])).toBe('🏆 שיא אישי חדש ב־5 ק״מ');
    expect(personalRecordBody(['5k', 'hm'])).toContain('2 שיאים אישיים');
  });
});

function fakeDb(existing: Array<{ activityId: string }>, opts: { priorError?: boolean } = {}) {
  const inserts: unknown[] = [];
  const db = {
    from() {
      const f: { in?: unknown[] } = {};
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, limit: () => b,
        in: (_c: string, v: unknown[]) => { f.in = v; return b; },
        insert: async (row: unknown) => { inserts.push(row); return { error: null }; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(opts.priorError
          ? { data: null, error: { message: 'x' } }
          : { data: existing.filter((e) => (f.in ?? []).includes(e.activityId)).map(() => ({ id: 'x' })), error: null }).then(resolve),
      };
      return b;
    },
  };
  return { db, inserts };
}

describe('postPersonalRecordCard', () => {
  beforeEach(() => { h.flag = true; });

  it('flag off (the default): no card', async () => {
    h.flag = false;
    const { db, inserts } = fakeDb([]);
    expect(await postPersonalRecordCard(db as never, 'me', 'g-today', ['g-today', 's-today'], [{ bucket: '5k' }])).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('posts once; a card already up under the twin id blocks a second', async () => {
    const first = fakeDb([]);
    expect(await postPersonalRecordCard(first.db as never, 'me', 'g-today', ['g-today', 's-today'], [{ bucket: '5k' }])).toBe(true);
    expect(first.inserts).toHaveLength(1);
    expect(first.inserts[0]).toMatchObject({ type: 'achievement', author_athlete_id: 'me', payload: { kind: PERSONAL_RECORD_KIND } });

    const twin = fakeDb([{ activityId: 's-today' }]);
    expect(await postPersonalRecordCard(twin.db as never, 'me', 'g-today', ['g-today', 's-today'], [{ bucket: '5k' }])).toBe(false);
    expect(twin.inserts).toHaveLength(0);
  });

  it('a failed "already posted?" read posts nothing', async () => {
    const { db, inserts } = fakeDb([], { priorError: true });
    expect(await postPersonalRecordCard(db as never, 'me', 'g-today', ['g-today'], [{ bucket: '5k' }])).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
