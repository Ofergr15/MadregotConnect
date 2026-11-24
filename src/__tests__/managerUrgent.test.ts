import { describe, expect, it } from 'vitest';
import { mayReadManagerHome, urgentItems, urgentPain, urgentRequests } from '@/lib/admin/urgent';

const NOW = '2026-11-24T12:00:00.000Z';
const fb = (id: string, athleteId: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, athleteId, createdAt, pain: true, wantsFeedback: false, comment: null, coachReplyAt: null, messages: [], ...extra,
});
const names = new Map([['a1', 'נועה ברק'], ['a2', 'דנה רוזן']]);

describe('urgentPain (≥ 4 h, unanswered)', () => {
  it('takes waiting pain past 4 h, oldest first, one per runner', () => {
    const out = urgentPain([
      fb('f1', 'a1', '2026-11-24T07:00:00.000Z'),
      fb('f2', 'a1', '2026-11-24T06:00:00.000Z'),
      fb('f3', 'a2', '2026-11-24T09:00:00.000Z'),   // 3 h — not yet
    ], names, NOW);
    expect(out.map((x) => x.id)).toEqual(['f2']);
    expect(out[0]).toMatchObject({ kind: 'pain', name: 'נועה ברק', hoursWaiting: 6 });
  });
  it('an answered report is not urgent; a runner writing again makes it wait again', () => {
    expect(urgentPain([fb('f1', 'a1', '2026-11-24T01:00:00.000Z', { coachReplyAt: '2026-11-24T02:00:00.000Z' })], names, NOW)).toEqual([]);
    const again = fb('f1', 'a1', '2026-11-24T01:00:00.000Z', { messages: [
      { createdAt: '2026-11-24T02:00:00.000Z', fromStaff: true }, { createdAt: '2026-11-24T03:00:00.000Z', fromStaff: false }] });
    expect(urgentPain([again], names, NOW)).toHaveLength(1);
  });
  it('exactly 4 h counts', () => {
    expect(urgentPain([fb('f1', 'a1', '2026-11-24T08:00:00.000Z')], names, NOW)).toHaveLength(1);
  });
});

describe('urgentRequests (≥ 48 h, not approved)', () => {
  const r = (id: string, createdAt: string, approved = false) => ({ id, createdAt, athleteId: null, fullName: `  ${id} `, approved });
  it('48 h and older, oldest first, trimmed name', () => {
    const out = urgentRequests([r('b', '2026-11-22T11:00:00.000Z'), r('a', '2026-11-21T00:00:00.000Z'), r('c', '2026-11-23T00:00:00.000Z')], NOW);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
    expect(out[0].name).toBe('a');
  });
  it('an already-approved person is bookkeeping, not urgent', () => {
    expect(urgentRequests([r('a', '2026-11-01T00:00:00.000Z', true)], NOW)).toEqual([]);
  });
});

describe('urgentItems + gate', () => {
  it('pain before requests', () => {
    const p = urgentPain([fb('f1', 'a1', '2026-11-24T01:00:00.000Z')], names, NOW);
    const q = urgentRequests([{ id: 'r', createdAt: '2026-11-01T00:00:00.000Z', athleteId: null, fullName: 'x', approved: false }], NOW);
    expect(urgentItems(p, q).map((x) => x.kind)).toEqual(['pain', 'request']);
  });
  it('admin, academy manager and super user only', () => {
    expect(mayReadManagerHome({ isSuperUser: true })).toBe(true);
    expect(mayReadManagerHome({ isSuperUser: false, role: 'admin' })).toBe(true);
    expect(mayReadManagerHome({ isSuperUser: false, role: 'coach', roles: ['coach', 'academy_manager'] })).toBe(true);
    expect(mayReadManagerHome({ isSuperUser: false, role: 'coach' })).toBe(false);
    expect(mayReadManagerHome({ isSuperUser: false, role: 'academy_coach' })).toBe(false);
  });
});
