import { describe, expect, it } from 'vitest';
import { addDays, computeClubNumbers, loadState, packOf, sundayOf, type NAthlete, type NRun } from '@/lib/club-numbers/compute';
import { resolveNavItems } from '@/lib/nav-items';

const athlete = (id: string, over: Partial<NAthlete> = {}): NAthlete => ({
  id, name: `Runner ${id}`, status: 'active', role: 'runner', isAcademy: false, bandNumber: null, academyJoinedOn: null,
  groupName: 'Group A - SUB 2:30', createdAt: '2026-07-01T10:00:00Z', firstSeenAt: '2026-07-02T10:00:00Z', lastSeenAt: '2026-10-19T10:00:00Z',
  approved: true, watch: true, birthDate: '1990-01-01', gender: 'male', ...over,
});
const run = (athleteId: string, date: string, km: number, hour = 6): NRun => ({ athleteId, start: `${date}T${String(hour).padStart(2, '0')}:00:00+00:00`, meters: km * 1000, seconds: km * 300, type: 'running' });

describe('helpers', () => {
  it('weeks start on Sunday', () => {
    expect(sundayOf('2026-10-20')).toBe('2026-10-18');
    expect(sundayOf('2026-10-18')).toBe('2026-10-18');
    expect(addDays('2026-10-18', 7)).toBe('2026-10-25');
  });
  it('names the pack', () => {
    expect(packOf({ isAcademy: false, bandNumber: null, groupName: 'Group B - SUB 2:35' })).toBe('דבוקה 2');
    expect(packOf({ isAcademy: true, bandNumber: 6, groupName: 'Group A' })).toBe('דבוקה 6');
    expect(packOf({ isAcademy: false, bandNumber: null, groupName: null })).toBe('בלי דבוקה');
  });
  it('reads the load as a ratio of a normal week', () => {
    expect(loadState(104, 100)).toEqual({ ratio: 1.04, state: 'normal' });
    expect(loadState(140, 100).state).toBe('spike');
    expect(loadState(70, 100).state).toBe('drop');
    expect(loadState(10, 0)).toEqual({ ratio: null, state: 'none' });
  });
});

describe('computeClubNumbers', () => {
  const today = '2026-10-20'; // a Tuesday
  const runs: NRun[] = [];
  // "a" runs 3 times every week since July; "b" stopped two weeks ago; the trainee runs twice a week.
  for (let w = '2026-07-05'; w <= '2026-10-18'; w = addDays(w, 7)) {
    for (const d of [0, 2, 5]) if (addDays(w, d) <= today) runs.push(run('a', addDays(w, d), 10));
    if (w < '2026-10-04') for (const d of [2, 5]) runs.push(run('b', addDays(w, d), 12));
    for (const d of [1, 4]) if (addDays(w, d) <= today) runs.push(run('t', addDays(w, d), 8));
  }
  const out = computeClubNumbers({
    today,
    athletes: [
      athlete('a'), athlete('b', { lastSeenAt: '2026-08-01T00:00:00Z' }),
      athlete('t', { isAcademy: true, bandNumber: 4, academyJoinedOn: '2026-09-06' }),
      athlete('p', { status: 'invited', approved: false, firstSeenAt: null }),
      athlete('admin', { role: 'admin' }),
      athlete('x', { name: 'Test Runner' }),
    ],
    runs,
    candidates: [{ id: 'c1', name: 'Real', source: 'instagram', createdAt: '2026-09-30', athleteId: 't', stages: ['form', 'intro_call'] }, { id: 'c2', name: 'Test Candidate', source: 'instagram', createdAt: '2026-09-19', athleteId: null, stages: [] }],
    tested: new Set(['t']), formed: new Set(), planned: new Set(),
  });

  it('counts the club and the academy apart, without admin and test accounts', () => {
    expect(out.overview.club.members).toBe(2);
    expect(out.overview.academy.trainees).toBe(1);
    expect(out.overview.club.entry.pending.map((p) => p.id)).toEqual(['p']);
  });
  it('compares this week with last week at the same day', () => {
    expect(out.dayIndex).toBe(2);
    expect(out.overview.club.soFar).toBe(10 + 10 + 8); // a: Sun+Tue, t: Mon
    expect(out.overview.club.lastSame).toBe(20 + 8);
  });
  it('places a trainee at the first step not yet done', () => {
    const t = out.overview.academy.traineeRows[0];
    expect(t.done).toMatchObject({ inApp: true, watch: true, test: true, form: false });
    expect(t.next).toBe('form');
  });
  it('leaves test candidates out of the funnel and stops before the standing order', () => {
    expect(out.academy.funnel.map((f) => f.stage)).not.toContain('standing_order');
    expect(out.academy.funnel[0]).toEqual({ stage: 'contact', count: 1 });
  });
  it('flags the drop and the silence', () => {
    expect(out.attention.dropping.map((r) => r.id)).toContain('b');
    expect(out.attention.notOpening.map((r) => r.id)).toEqual(['b']);
  });
  it('offers for the core whoever ran 3+ in 7 of the last 8 weeks — one week off is allowed (10-28)', async () => {
    const { CORE_WEEKS_OFF } = await import('@/lib/club-numbers/compute');
    expect(CORE_WEEKS_OFF).toBe(1);
  });
  it('takes the core from the club flag, and offers who fits the rule', () => {
    expect(out.core.runners).toEqual([]);
    expect(out.core.suggested.map((r) => r.id)).toEqual(['a']);
    const flagged = computeClubNumbers({ today, athletes: [athlete('a'), athlete('t', { isAcademy: true, core: true })], runs, candidates: [], tested: new Set<string>(), formed: new Set<string>(), planned: new Set<string>() });
    expect(flagged.core.runners.map((r) => r.id)).toEqual(['t']);
    expect(flagged.core.suggested.map((r) => r.id)).toEqual(['a']);
  });
});

describe('the ניהול tab for a club manager', () => {
  it('is added for a manager without a staff role, and not while previewing', () => {
    const tabs = (o: Parameters<typeof resolveNavItems>[0]) => resolveNavItems(o).map((i) => i.tab);
    expect(tabs({ permissions: [], effectiveRole: 'runner', isAthlete: true, isClubManager: true })).toContain('club-numbers');
    expect(tabs({ permissions: [], effectiveRole: 'runner', isAthlete: true })).not.toContain('club-numbers');
    expect(tabs({ permissions: [], effectiveRole: 'runner', isAthlete: true, isClubManager: true, previewRole: 'runner' })).not.toContain('club-numbers');
  });
});
