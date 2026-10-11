import { describe, expect, it } from 'vitest';
import { doneLaps } from '@/lib/trainee/done-laps';

describe('doneLaps (screen 5 "הקפות")', () => {
  const done = {
    reps: [{ paceSec: 245, tone: 'in' }, { paceSec: 244, tone: 'in' }, { paceSec: 236, tone: 'fast' }],
    band: { min: 241, max: 249 },
  } as any;

  it('the reps and the range of the reps chart, rep 1 first — never the old sheet\'s band', () => {
    const chart = { mode: 'reps', bandMin: 235, bandMax: 255, target: 245, points: [] } as any;
    expect(doneLaps(done, chart)).toEqual({
      mode: 'reps',
      band: { min: 241, max: 249 },
      rows: [{ n: 1, paceSec: 245, tone: 'in' }, { n: 2, paceSec: 244, tone: 'in' }, { n: 3, paceSec: 236, tone: 'fast' }],
    });
  });

  it('a run with no reps lists its kilometres against the sheet\'s band', () => {
    const chart = { mode: 'km', bandMin: 320, bandMax: 340, target: 330, points: [
      { label: 'ק״מ 1', pace: 345, kind: 'slow' }, { label: '2', pace: 330, kind: 'on' }, { label: '3', pace: 310, kind: 'fast' },
    ] } as any;
    expect(doneLaps({ reps: [], band: null } as any, chart)).toEqual({
      mode: 'km',
      band: { min: 320, max: 340 },
      rows: [{ n: 1, paceSec: 345, tone: 'slow' }, { n: 2, paceSec: 330, tone: 'in' }, { n: 3, paceSec: 310, tone: 'fast' }],
    });
  });

  it('nothing to list', () => {
    expect(doneLaps(null, null)).toBeNull();
    expect(doneLaps({ reps: [], band: null } as any, { mode: 'reps', bandMin: 1, bandMax: 2, target: 1, points: [] } as any)).toBeNull();
  });
});
