import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kmByShoe, effectiveLimitKm, dueShoeAlert, DEFAULT_RETIRE_KM } from '@/lib/shoes/mileage';
import { FEATURES } from '@/lib/features/flags';

const act = (id: string, start: string, km: number, source: string, shoe: string | null = 's1', duration = 3000) =>
  ({ id, shoe_id: shoe, athlete_id: 'a1', start_time: start, distance: km * 1000, duration, source });

describe('shoe mileage — twins counted once', () => {
  it('a Garmin run and its Strava copy on the same shoe count once', () => {
    const km = kmByShoe([act('g', '2026-11-20T06:00:00Z', 10, 'garmin'), act('s', '2026-11-20T06:00:40Z', 10.05, 'strava')]);
    expect(km.get('s1')).toBeCloseTo(10, 5);
  });
  it('two different runs the same morning both count', () => {
    const km = kmByShoe([act('a', '2026-11-20T06:00:00Z', 10, 'garmin', 's1', 3000), act('b', '2026-11-20T08:00:00Z', 5, 'garmin', 's1', 1500)]);
    expect(km.get('s1')).toBeCloseTo(15, 5);
  });
  it('a twin where only one copy carries the shoe counts once', () => {
    const km = kmByShoe([act('g', '2026-11-20T06:00:00Z', 10, 'garmin', null), act('s', '2026-11-20T06:00:30Z', 10, 'strava', 's1')]);
    expect(km.get('s1')).toBeCloseTo(10, 5);
  });
  it('unattributed runs count for no shoe', () => {
    expect(kmByShoe([act('x', '2026-11-20T06:00:00Z', 10, 'garmin', null)]).size).toBe(0);
  });
});

describe('retire threshold — default-off', () => {
  it('flag is default-off', () => expect(FEATURES.shoe_retire_alert.defaultEnabled).toBe(false));
  it('own limit wins; no limit means no alert unless the flag is on', () => {
    expect(effectiveLimitKm(600, false)).toBe(600);
    expect(effectiveLimitKm(600, true)).toBe(600);
    expect(effectiveLimitKm(null, false)).toBeNull();
    expect(effectiveLimitKm(null, true)).toBe(DEFAULT_RETIRE_KM);
  });
  it('near, then over, each once; nothing for a retired shoe', () => {
    const base = { limitKm: 700, alertBeforeKm: 50, alertedNear: false, alertedOver: false, retired: false };
    expect(dueShoeAlert({ ...base, totalKm: 600 })).toBeNull();
    expect(dueShoeAlert({ ...base, totalKm: 655 })).toBe('near');
    expect(dueShoeAlert({ ...base, totalKm: 655, alertedNear: true })).toBeNull();
    expect(dueShoeAlert({ ...base, totalKm: 702, alertedNear: true })).toBe('over');
    expect(dueShoeAlert({ ...base, totalKm: 702, alertedNear: true, alertedOver: true })).toBeNull();
    expect(dueShoeAlert({ ...base, totalKm: 900, retired: true })).toBeNull();
    expect(dueShoeAlert({ ...base, totalKm: 699, alertBeforeKm: 0 })).toBeNull();
  });
});

describe('checkShoeAlert', () => {
  const notify = vi.fn(async () => ({}));
  let flag = false;
  let rows: Record<string, unknown>[] = [];
  let shoe: Record<string, unknown> = {};
  beforeEach(() => {
    vi.resetModules();
    notify.mockClear();
    vi.doMock('@/lib/push', () => ({ notifyAthlete: notify }));
    vi.doMock('@/lib/features/server', () => ({ isFeatureEnabled: async () => flag }));
    vi.doMock('@/lib/supabase/server', () => ({
      createServerClient: () => ({
        from: (t: string) => {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          Object.assign(q, {
            select: chain, eq: chain, order: chain,
            maybeSingle: async () => ({ data: t === 'shoes' ? shoe : null, error: null }),
            range: async () => ({ data: rows, error: null }),
            update: () => ({ eq: async () => ({ error: null }) }),
          });
          return q;
        },
      }),
    }));
  });

  it('twins no longer trip the replace push early', async () => {
    shoe = { id: 's1', athlete_id: 'a1', name: 'Pegasus', distance_limit_km: 700, alert_before_km: 50, retired: false };
    // 34 runs of 10 km, each also present as a Strava twin = 340 real km (680 if doubled).
    rows = Array.from({ length: 34 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i, 6));
      return [act(`g${i}`, d.toISOString(), 10, 'garmin'), act(`s${i}`, new Date(d.getTime() + 30_000).toISOString(), 10, 'strava')];
    }).flat();
    const { checkShoeAlert } = await import('@/lib/shoes');
    await checkShoeAlert('s1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a shoe with no limit stays silent with the flag off, alerts with it on', async () => {
    shoe = { id: 's1', athlete_id: 'a1', name: 'Pegasus', distance_limit_km: null, alert_before_km: null, retired: false };
    rows = Array.from({ length: 71 }, (_, i) => act(`g${i}`, new Date(Date.UTC(2026, 0, 1 + i, 6)).toISOString(), 10, 'garmin'));
    flag = false;
    let { checkShoeAlert } = await import('@/lib/shoes');
    await checkShoeAlert('s1');
    expect(notify).not.toHaveBeenCalled();
    flag = true;
    vi.resetModules();
    ({ checkShoeAlert } = await import('@/lib/shoes'));
    await checkShoeAlert('s1');
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
