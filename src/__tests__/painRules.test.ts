import { describe, expect, it } from 'vitest';
import { followupDue, isSevere, parsePainInput, pickOneFollowupPerRunner, resolvePainRecipients, staffMaySeePain } from '@/lib/feedback/pain';
import { feelAverage } from '@/lib/academy/readiness';

const base = { status: 'open' as const, createdOn: '2026-11-20', lastAskedOn: null, lastTrend: null, escalated: false };

describe('follow-up cadence', () => {
  it('next day at 09:00, only at 09:00', () => {
    expect(followupDue(base, '2026-11-20', 9)).toBeNull();
    expect(followupDue(base, '2026-11-21', 9)).toBe('ask');
    expect(followupDue(base, '2026-11-21', 10)).toBeNull();
  });
  it('then every 2 days, never twice a day', () => {
    expect(followupDue({ ...base, lastAskedOn: '2026-11-21' }, '2026-11-21', 9)).toBeNull();
    expect(followupDue({ ...base, lastAskedOn: '2026-11-21' }, '2026-11-22', 9)).toBeNull();
    expect(followupDue({ ...base, lastAskedOn: '2026-11-21' }, '2026-11-23', 9)).toBe('ask');
  });
  it('stops at gone, closed or withdrawn', () => {
    expect(followupDue({ ...base, lastTrend: 'gone' }, '2026-11-23', 9)).toBeNull();
    expect(followupDue({ ...base, status: 'resolved' }, '2026-11-23', 9)).toBeNull();
    expect(followupDue({ ...base, status: 'withdrawn' }, '2026-11-23', 9)).toBeNull();
  });
  it('after 14 days asks the coach once, never the runner', () => {
    expect(followupDue({ ...base, lastAskedOn: '2026-12-02' }, '2026-12-04', 9)).toBe('ask'); // day 14
    expect(followupDue({ ...base, lastAskedOn: '2026-12-02' }, '2026-12-05', 9)).toBe('escalate');
    expect(followupDue({ ...base, escalated: true }, '2026-12-06', 9)).toBeNull();
  });
  it('one question per runner per day: the oldest report asks', () => {
    const out = pickOneFollowupPerRunner([
      { athleteId: 'a', createdAt: '2026-11-19', id: 2 }, { athleteId: 'a', createdAt: '2026-11-18', id: 1 }, { athleteId: 'b', createdAt: '2026-11-19', id: 3 },
    ]);
    expect(out.map((o) => o.id).sort()).toEqual([1, 3]);
  });
});

const roles = { c1: ['coach'], c2: ['coach'], ac1: ['academy_coach'], m1: ['runner', 'academy_manager'], su: ['admin'], r1: ['runner'] };
describe('pain recipients', () => {
  it('club runner → club coaches only, never managers', () => {
    expect(resolvePainRecipients({ runnerId: 'x', isAcademy: false, academyCoaches: [], managers: ['m1'], clubCoaches: ['c1', 'c2'], rolesOf: roles, routedRoles: null })).toEqual(['c1', 'c2']);
  });
  it('academy trainee → their coaches + managers', () => {
    expect(resolvePainRecipients({ runnerId: 'x', isAcademy: true, academyCoaches: ['ac1'], managers: ['m1'], clubCoaches: ['c1'], rolesOf: roles, routedRoles: null })).toEqual(['ac1', 'm1']);
  });
  it('routing only narrows, [] is nobody, and a runner never resolves', () => {
    const f = { runnerId: 'x', isAcademy: false, academyCoaches: [], managers: [], clubCoaches: ['c1', 'r1'], rolesOf: roles };
    expect(resolvePainRecipients({ ...f, routedRoles: null })).toEqual(['c1']);
    expect(resolvePainRecipients({ ...f, routedRoles: ['admin'] })).toEqual([]);
    expect(resolvePainRecipients({ ...f, routedRoles: [] })).toEqual([]);
    expect(resolvePainRecipients({ ...f, clubCoaches: ['x', 'c1'], routedRoles: null })).toEqual(['c1']);
  });
  it('staff read scope mirrors the alert', () => {
    expect(staffMaySeePain({ athleteId: 'm1', isSuperUser: false, roles: ['academy_manager'] }, { isAcademy: false, academyCoachIds: [] })).toBe(false);
    expect(staffMaySeePain({ athleteId: 'm1', isSuperUser: false, roles: ['academy_manager'] }, { isAcademy: true, academyCoachIds: [] })).toBe(true);
    expect(staffMaySeePain({ athleteId: 'ac1', isSuperUser: false, roles: ['academy_coach'] }, { isAcademy: true, academyCoachIds: ['ac2'] })).toBe(false);
    expect(staffMaySeePain({ athleteId: 'c1', isSuperUser: false, roles: ['coach'] }, { isAcademy: false, academyCoachIds: [] })).toBe(true);
  });
});

describe('pain input', () => {
  it('validates and flags severe', () => {
    const ok = parsePainInput({ area: 'knee', side: 'left', severity: 7, since: 'today', effect: 'altered' });
    expect(ok.ok).toBe(true);
    expect(parsePainInput({ area: 'elbow', severity: 3, since: 'today', effect: 'none' })).toEqual({ ok: false, field: 'area' });
    expect(parsePainInput({ area: 'knee', severity: 11, since: 'today', effect: 'none' })).toEqual({ ok: false, field: 'severity' });
    expect(isSevere({ severity: 7, effect: 'none' })).toBe(true);
    expect(isSevere({ severity: 3, effect: 'cannot_run' })).toBe(true);
    expect(isSevere({ severity: 6, effect: 'altered' })).toBe(false);
  });
});

describe('readiness with RPE-only club feedback (decision 7: feel dropped)', () => {
  it('rows without feel never pull the average down', () => {
    expect(feelAverage([{ feel: null, date: '2026-11-20' }, { feel: null, date: '2026-11-19' }])).toBeNull();
    expect(feelAverage([{ feel: null, date: '2026-11-21' }, { feel: 3, date: '2026-11-20' }])).toBe(3);
  });
});
