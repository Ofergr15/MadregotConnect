import { describe, expect, it } from 'vitest';
import { statusOf, summarize, withResults } from '@/lib/week-setup/watch-results';

const now = '2026-10-24T19:00:00Z';
const send = (ids: Array<[string, boolean]>) => ids.map(([id, ok]) => ({ athleteId: id, athleteName: `R ${id}`, status: ok ? 'success' : 'failed', ...(ok ? {} : { error: 'Garmin timeout' }) }));

describe('who has the week on their watch (week-setup v2, 10-24)', () => {
  it('a whole send replaces the record; the failed are named with why', () => {
    const store = withResults({}, '2026-10-25', send([['a', true], ['b', false], ['c', true]]), { partial: false, by: 'Yair', now, today: '2026-10-24' });
    const s = summarize(store['2026-10-25']);
    expect(s).toMatchObject({ ok: 2, total: 3 });
    expect(s.failed).toEqual([{ id: 'b', name: 'R b', error: 'Garmin timeout' }]);
    expect(statusOf(store['2026-10-25'], true)).toBe('partial');
  });
  it('a resend to the ones who failed updates only theirs — and a failed resend never makes the week "draft"', () => {
    let store = withResults({}, '2026-10-25', send([['a', true], ['b', false], ['c', false]]), { partial: false, by: 'Yair', now, today: '2026-10-24' });
    store = withResults(store, '2026-10-25', send([['b', false], ['c', false]]), { partial: true, by: 'Ofer', now, today: '2026-10-24' });
    expect(summarize(store['2026-10-25'])).toMatchObject({ ok: 1, total: 3 });
    expect(statusOf(store['2026-10-25'], true)).toBe('partial');
    store = withResults(store, '2026-10-25', send([['b', true], ['c', true]]), { partial: true, by: 'Ofer', now, today: '2026-10-24' });
    expect(summarize(store['2026-10-25'])).toMatchObject({ ok: 3, total: 3, failed: [] });
    expect(statusOf(store['2026-10-25'], true)).toBe('pushed');
  });
  it('old weeks are dropped', () => {
    const store = withResults({ '2026-09-06': { at: now, by: 'x', runners: {} } }, '2026-10-25', send([['a', true]]), { partial: false, by: 'Yair', now, today: '2026-10-24' });
    expect(Object.keys(store)).toEqual(['2026-10-25']);
  });
});
