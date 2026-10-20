import { describe, expect, it } from 'vitest';
import { faceSignals, wallAreas, wallSections, type Person } from '@/lib/admin/people';

/** The People wall (2026-10-20): who is in each area, three signals per face. */
const T = '2026-10-20';
const base: Person = {
  id: 'a', name: 'Noa Levi', role: 'runner', groupId: 'g1', groupName: 'Group 1', status: 'active', approved: true,
  source: 'garmin', lastRunDay: '2026-10-19', lastSeenAt: '2026-10-20T07:00:00Z', joinedAt: '2026-09-01', setupDone: true,
  pushDevices: 1, lastPushAt: null,
};
const p = (o: Partial<Person>): Person => ({ ...base, ...o });
const LABELS = { academy: 'אקדמיה', core: 'גרעין', staff: 'צוות', waiting: 'ממתינים', noPack: 'בלי דבוקה' };
const areas = wallAreas([{ id: 'g1', name: 'Group 1' }, { id: 'g2', name: 'Group 2' }], (n) => `דבוקה ${n}`, LABELS);

describe('the three signals on a face', () => {
  it('all grey for somebody active this week', () => {
    expect(faceSignals(base, T)).toMatchObject({ app: 'ok', watch: 'ok', run: 'ok', push: 'ok', faded: false });
  });
  it('red for no watch, a week away from the app, a week without running', () => {
    const s = faceSignals(p({ source: null, lastSeenAt: '2026-10-10T07:00:00Z', lastRunDay: '2026-10-05' }), T);
    expect(s).toMatchObject({ app: 'bad', watch: 'bad', run: 'bad', appDays: 10, runDays: 15 });
  });
  it('never opened the app: red, and the face drawn faded', () => {
    expect(faceSignals(p({ lastSeenAt: null }), T)).toMatchObject({ app: 'bad', faded: true });
  });
  it('waiting for approval: nothing to judge yet, faded', () => {
    const s = faceSignals(p({ approved: false, source: null, lastRunDay: null, pushDevices: 0 }), T);
    expect(s).toMatchObject({ app: 'off', watch: 'off', run: 'off', push: 'off', faded: true });
  });
  it('notifications that stopped arriving are red', () => {
    expect(faceSignals(p({ pushDead: true }), T).push).toBe('bad');
  });
});

describe('the areas', () => {
  const people = [
    p({ id: '1', name: 'A' }),
    p({ id: '2', name: 'B', groupId: 'g2', isCore: true }),
    p({ id: '3', name: 'C', groupId: null, isAcademy: true }),
    p({ id: '4', name: 'D', role: 'coach', groupId: null }),
    p({ id: '5', name: 'E', approved: false }),
    p({ id: '6', name: 'F', groupId: null }),
  ];
  it('one filter shows that area, a person in two areas in both', () => {
    expect(wallSections(people, areas, 'core').map((s) => s.people.map((x) => x.id))).toEqual([['2']]);
    expect(wallSections(people, areas, 'pack:g2')[0].people.map((x) => x.id)).toEqual(['2']);
  });
  it('"all" shows everybody once, in the first area that holds them', () => {
    const all = wallSections(people, areas, 'all');
    expect(all.map((s) => s.area.label)).toEqual(['דבוקה 1', 'דבוקה 2', 'אקדמיה', 'צוות', 'ממתינים', 'בלי דבוקה']);
    expect(all.flatMap((s) => s.people.map((x) => x.id)).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });
  it('waiting members are not counted in their pack', () => {
    expect(wallSections(people, areas, 'pack:g1')[0].people.map((x) => x.id)).toEqual(['1']);
  });
});
