import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
vi.mock('@/lib/quality-session/server', () => ({ loadQualityWorkout: async () => ({ name: 'שלישי' }) }));
import { longestPerDay, wholeDays, qualityNamesForPage } from '@/lib/activities/quality-name';

// 2026-11-25: the 21 km run was off the club page; the 2 km jog on it took the quality name.
const jog = { id: 'jog', athlete_id: 'a', start_time: '2026-11-24T07:47:56', distance: 2009 };
const long = { id: 'long', athlete_id: 'a', start_time: '2026-11-24T05:28:52', distance: 21324 };
const other = { id: 'x', athlete_id: 'a', start_time: '2026-11-23T09:02:04', distance: 6007 };

function db(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'or', 'in', 'gte', 'lte']) q[k] = () => q;
  q.limit = async () => ({ data: rows, error: null });
  q.eq = () => q; q.maybeSingle = async () => ({ data: null, error: null });
  return { from: () => q } as never;
}

describe('the quality name is decided over the runner\'s whole day', () => {
  it('a page holding only the jog no longer names the jog', async () => {
    expect(longestPerDay([jog]).has('jog')).toBe(true); // the old, page-only answer
    const names = await qualityNamesForPage(db([jog, long, other]), [jog]);
    expect(names.has('jog')).toBe(false);
    expect(names.has('long')).toBe(false); // answered for the page's runs only
  });
  it('the long run on the page still takes it', async () => {
    const names = await qualityNamesForPage(db([jog, long]), [jog, long]);
    expect(names.get('long')).toBe('שלישי');
    expect(names.has('jog')).toBe(false);
  });
  it('only the page runners\' same days are added', () => {
    expect(wholeDays([jog], [long, other]).map((r) => r.id).sort()).toEqual(['jog', 'long']);
  });
  it('a failed day read falls back to the page alone', async () => {
    const bad = { from: () => { throw new Error('down'); } } as never;
    expect((await qualityNamesForPage(bad, [jog])).has('jog')).toBe(true);
  });
});
