import { describe, expect, it, vi } from 'vitest';
import { createMemoryDb, uid } from './helpers/memory-db';

/**
 * QA 24.11 Q24-4: the serial sweeps stop at a time budget, report `partial`, and leave a
 * cursor so the next run resumes with whoever the cut-short one never reached.
 */

const getWellness = vi.fn(async () => ({ sleepSeconds: 25000, restingHr: 50 }));
vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class { getWellness() { return getWellness(); } },
  emptyWellnessShapes: () => [],
}));

const { rotateAfter, deadlineFrom, SWEEP_BUDGET_MS } = await import('@/lib/cron/budget');
const { sweepWellness } = await import('@/lib/wellness/sweep');

describe('rotateAfter', () => {
  const xs = ['c', 'a', 'b', 'd'].map((id) => ({ id }));
  it('sorts by id, and starts after the cursor, wrapping', () => {
    expect(rotateAfter(xs, null).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateAfter(xs, 'b').map((x) => x.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(rotateAfter(xs, 'd').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateAfter(xs, 'bb').map((x) => x.id)).toEqual(['c', 'd', 'a', 'b']);
  });
});

describe('deadlineFrom', () => {
  it('stops well inside the 300 s ceiling', () => {
    expect(SWEEP_BUDGET_MS).toBeLessThanOrEqual(280_000);
    expect(deadlineFrom(Date.now())()).toBe(false);
    expect(deadlineFrom(Date.now() - SWEEP_BUDGET_MS)()).toBe(true);
  });
});

function wellnessDb(n: number) {
  const db = createMemoryDb({
    schema: {
      athletes: ['id', 'garmin_auth', 'is_academy', 'status'],
      athlete_wellness: ['athlete_id', 'date', 'sleep_seconds', 'resting_hr', 'fetched_at'],
    },
    unique: { athlete_wellness: [['athlete_id', 'date']] },
  });
  const ids = Array.from({ length: n }, () => uid()).sort();
  for (const id of ids) db.tables.athletes.push({ id, garmin_auth: 'x', is_academy: false, status: 'active' });
  return { db, ids };
}

describe('sweepWellness under a time budget', () => {
  it('stops when out of time, says partial, and the cursor resumes the rest', async () => {
    const { db, ids } = wellnessDb(4);
    // 4 checks in the first loop pass, then 2 athletes in the second, then out of time.
    let checks = 0;
    const r1 = await sweepWellness(db.client as never, '2026-10-13', { outOfTime: () => ++checks > 6 });
    expect(r1.partial).toBe(true);
    expect(r1.cursor).toBe(ids[1]);
    const done = new Set(db.tables.athlete_wellness.map((w: any) => w.athlete_id));
    expect(done).toEqual(new Set([ids[0], ids[1]]));

    getWellness.mockClear();
    const r2 = await sweepWellness(db.client as never, '2026-10-13', { cursor: r1.cursor });
    expect(r2.partial).toBe(false);
    expect(r2.cursor).toBeNull();
    expect(new Set(db.tables.athlete_wellness.map((w: any) => w.athlete_id))).toEqual(new Set(ids));
  });

  it('a run with time left is not partial', async () => {
    const { db } = wellnessDb(2);
    const r = await sweepWellness(db.client as never, '2026-10-13');
    expect(r.partial).toBe(false);
    expect(r.cursor).toBeNull();
  });
});

describe('route ceilings', () => {
  it('badges, wellness and the Strava webhook all get 300 s', async () => {
    const fs = await import('node:fs');
    for (const f of ['cron/badges', 'cron/wellness', 'strava/webhook']) {
      const src = fs.readFileSync(`src/app/api/${f}/route.ts`, 'utf8');
      expect(src, f).toMatch(/export const maxDuration = 300;/);
    }
  });
});
