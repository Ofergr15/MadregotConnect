import { describe, expect, it } from 'vitest';
import { perKmFromStream } from '@/lib/activities/stream-per-km';
import { parseActivityStream } from '@/lib/garmin/streams';

describe('perKmFromStream (#74)', () => {
  const splits = [{ distance: 1000 }, { distance: 1000 }, { distance: 1180 }];
  const d = [0, 500, 999, 1000, 1500, 2000, 2600, 3200];

  it('averages each split range and runs the last one to the end of the trace', () => {
    expect(perKmFromStream(splits, d, [null, null, null, 2, 4, 1, -1, -3])).toEqual([null, 3, -1]);
  });

  it('skips zero power as a dropped pod, but keeps a zero condition', () => {
    expect(perKmFromStream(splits, d, [0, 300, 310, 0, 0, 280, 0, 290], { skipZero: true })).toEqual([305, null, 285]);
    expect(perKmFromStream(splits, d, [0, 0, 0, 0, 0, 0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('gives nulls when the channel is missing or misaligned', () => {
    expect(perKmFromStream(splits, d, undefined)).toEqual([null, null, null]);
    expect(perKmFromStream(splits, d, [1, 2])).toEqual([null, null, null]);
  });
});

describe('parseActivityStream keeps power and performance condition', () => {
  const details = (pw: (number | null)[], pc: (number | null)[]) => ({
    metricDescriptors: [
      { key: 'sumDistance', metricsIndex: 0, unit: { key: 'meter' } },
      { key: 'sumElapsedDuration', metricsIndex: 1, unit: { key: 'second' } },
      { key: 'directPower', metricsIndex: 2 },
      { key: 'directPerformanceCondition', metricsIndex: 3 },
    ],
    activityDetailMetrics: pw.map((p, i) => ({ metrics: [i * 3, i, p, pc[i]] })),
  });

  it('stores both, with a not-yet condition as null rather than 0', () => {
    const s = parseActivityStream(details([300, 310, 320], [null, 0, 2]))!;
    expect(s.series.pw).toEqual([300, 310, 320]);
    expect(s.series.pc).toEqual([null, 0, 2]);
    expect(s.metrics).toEqual(expect.arrayContaining(['pw', 'pc']));
  });

  it('drops a channel with nothing in it', () => {
    const s = parseActivityStream(details([0, 0, 0], [null, null, null]))!;
    expect(s.series.pw).toBeUndefined();
    expect(s.series.pc).toBeUndefined();
  });
});
