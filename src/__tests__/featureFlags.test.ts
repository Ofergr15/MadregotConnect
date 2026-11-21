import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS, allowedScopeTypes, coachesAthlete, mayToggle, resolveFeature, visibleToManager, type EnablementRow } from '@/lib/features/flags';

const row = (scope_type: EnablementRow['scope_type'], scope_id: string, enabled: boolean): EnablementRow =>
  ({ feature: 'feedback_pain', scope_type, scope_id, enabled, set_by: 'x', set_at: '2026-11-21T10:00:00Z' });
const dana = { id: 'a1', groupId: 'g1', role: 'runner', extraRoles: [], isAcademy: true };

describe('resolveFeature — most specific wins, off by default', () => {
  it('is off with no rows', () => {
    expect(resolveFeature('feedback_pain', [], dana)).toEqual({ enabled: false, source: null });
  });
  it('club on reaches everyone', () => {
    expect(resolveFeature('feedback_pain', [row('club', '*', true)], dana).enabled).toBe(true);
  });
  it('athlete off beats squad on beats club on', () => {
    const rows = [row('club', '*', true), row('squad', 'g1', true), row('athlete', 'a1', false)];
    const r = resolveFeature('feedback_pain', rows, dana);
    expect(r.enabled).toBe(false);
    expect(r.source?.scopeType).toBe('athlete');
  });
  it('squad beats academy beats role beats club', () => {
    expect(resolveFeature('feedback_pain', [row('academy', 'academy', true), row('squad', 'g1', false)], dana).enabled).toBe(false);
    expect(resolveFeature('feedback_pain', [row('role', 'runner', false), row('academy', 'academy', true)], dana).enabled).toBe(true);
    expect(resolveFeature('feedback_pain', [row('club', '*', false), row('role', 'runner', true)], dana).enabled).toBe(true);
  });
  it('rows for other athletes, squads or a non-academy runner do not apply', () => {
    const club = { ...dana, isAcademy: false };
    expect(resolveFeature('feedback_pain', [row('athlete', 'a2', true), row('squad', 'g2', true), row('academy', 'academy', true)], club).enabled).toBe(false);
  });
  it('two roles disagreeing: off wins', () => {
    const r = resolveFeature('feedback_pain', [row('role', 'runner', true), row('role', 'coach', false)], { ...dana, extraRoles: ['coach'] });
    expect(r.enabled).toBe(false);
  });
});

const admin = { athleteId: 'ad', role: 'admin', roles: ['admin'], isSuperUser: false };
const sup = { athleteId: 'su', role: 'runner', roles: ['runner'], isSuperUser: true };
const manager = { athleteId: 'm1', role: 'runner', roles: ['runner', 'academy_manager'], isSuperUser: false };
const clubCoach = { athleteId: 'c1', role: 'coach', roles: ['coach'], isSuperUser: false };
const acCoach = { athleteId: 'ac1', role: 'academy_coach', roles: ['academy_coach'], isSuperUser: false };
const runner = { athleteId: 'r9', role: 'runner', roles: ['runner'], isSuperUser: false };

const ath = (isAcademy: boolean, coachedByCaller: boolean) => ({ scopeType: 'athlete' as const, scopeId: 'a1', athlete: { isAcademy, coachedByCaller } });

describe('mayToggle — who may toggle what', () => {
  it('admin and super user: every scope', () => {
    for (const c of [admin, sup]) {
      for (const t of [ath(false, false), { scopeType: 'squad' as const, scopeId: 'g1' }, { scopeType: 'role' as const, scopeId: 'runner' },
        { scopeType: 'academy' as const, scopeId: 'academy' }, { scopeType: 'club' as const, scopeId: '*' }]) {
        expect(mayToggle(c, t)).toBe(true);
      }
    }
  });
  it('academy manager: any academy trainee and the whole academy; not club runners, squads, roles, club', () => {
    expect(mayToggle(manager, ath(true, false))).toBe(true);
    expect(mayToggle(manager, { scopeType: 'academy', scopeId: 'academy' })).toBe(true);
    expect(mayToggle(manager, ath(false, false))).toBe(false);
    expect(mayToggle(manager, { scopeType: 'squad', scopeId: 'g1' })).toBe(false);
    expect(mayToggle(manager, { scopeType: 'club', scopeId: '*' })).toBe(false);
  });
  it('coach: only athletes they coach, never wider scopes', () => {
    expect(mayToggle(clubCoach, ath(false, true))).toBe(true);
    expect(mayToggle(clubCoach, ath(true, false))).toBe(false);
    expect(mayToggle(acCoach, ath(true, true))).toBe(true);
    expect(mayToggle(acCoach, ath(true, false))).toBe(false);
    expect(mayToggle(clubCoach, { scopeType: 'academy', scopeId: 'academy' })).toBe(false);
    expect(mayToggle(clubCoach, { scopeType: 'club', scopeId: '*' })).toBe(false);
  });
  it('a runner may toggle nothing, not even themself', () => {
    expect(mayToggle(runner, ath(false, true))).toBe(false);
    expect(mayToggle(runner, { scopeType: 'athlete', scopeId: 'r9', athlete: { isAcademy: false, coachedByCaller: false } })).toBe(false);
    expect(allowedScopeTypes(runner)).toEqual([]);
  });
  it('the academy scope id is fixed', () => {
    expect(mayToggle(manager, { scopeType: 'academy', scopeId: 'other' })).toBe(false);
  });
  it('allowed scopes per role', () => {
    expect(allowedScopeTypes(admin)).toHaveLength(5);
    expect(allowedScopeTypes(manager)).toEqual(['athlete', 'academy']);
    expect(allowedScopeTypes(clubCoach)).toEqual(['athlete']);
  });
});

describe('coachesAthlete / visibleToManager', () => {
  it('club coach coaches club runners and linked trainees; academy coach only linked', () => {
    expect(coachesAthlete(clubCoach, { isAcademy: false, academyCoachIds: [] })).toBe(true);
    expect(coachesAthlete(clubCoach, { isAcademy: true, academyCoachIds: [] })).toBe(false);
    expect(coachesAthlete(clubCoach, { isAcademy: true, academyCoachIds: ['c1'] })).toBe(true);
    expect(coachesAthlete(acCoach, { isAcademy: false, academyCoachIds: [] })).toBe(false);
  });
  it('manager lists academy trainees only', () => {
    expect(visibleToManager(manager, { isAcademy: true, academyCoachIds: [] })).toBe(true);
    expect(visibleToManager(manager, { isAcademy: false, academyCoachIds: [] })).toBe(false);
  });
});

describe('week_health (native השבוע בריאות layout)', () => {
  it('is a known key and off with no rows', () => {
    expect(FEATURE_KEYS).toContain('week_health');
    expect(resolveFeature('week_health', [], { id: 'a1', groupId: 'g1', role: 'runner', isAcademy: false }).enabled).toBe(false);
  });
});
