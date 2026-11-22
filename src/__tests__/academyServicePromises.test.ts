import { describe, expect, it } from 'vitest';
import {
  planDeadline, planPromise, oldestUnansweredHours, replyBroken, daysSinceContact, contactBroken,
  medianReplyHours, traineePromises, countPromises,
} from '@/lib/academy/service-promises';
import { checkAssignment, loadState, capacityOf, DEFAULT_CAPACITY } from '@/lib/academy/capacity';
import { parseSelfReport, reportNeedsCoach } from '@/lib/academy/self-report';
import { proposedZones, repaceOffset } from '@/lib/academy/benchmark-zones';
import { resolveHubView, availableViews, pipeline, executionPct, roundBuckets } from '@/lib/academy/hub';

describe('plan by Saturday 20:00 Israel', () => {
  it('winter deadline is Sat 18:00 UTC', () => {
    expect(planDeadline('2026-11-29').toISOString()).toBe('2026-11-28T18:00:00.000Z');
  });
  it('summer deadline is Sat 17:00 UTC', () => {
    expect(planDeadline('2026-07-05').toISOString()).toBe('2026-07-04T17:00:00.000Z');
  });
  it('open before, late after, ready whenever written', () => {
    expect(planPromise('2026-11-29', false, new Date('2026-11-28T17:59:00Z'))).toBe('open');
    expect(planPromise('2026-11-29', false, new Date('2026-11-28T18:01:00Z'))).toBe('late');
    expect(planPromise('2026-11-29', true, new Date('2026-12-01T00:00:00Z'))).toBe('ready');
  });
});

describe('reply within 24 h', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  it('counts from the oldest report after the last reply', () => {
    expect(oldestUnansweredHours(['2026-11-20T10:00:00Z', '2026-11-21T10:00:00Z'], ['2026-11-20T11:00:00Z'], now)).toBe(2);
    expect(oldestUnansweredHours(['2026-11-20T10:00:00Z'], [], now)).toBe(26);
    expect(oldestUnansweredHours(['2026-11-20T10:00:00Z'], ['2026-11-20T10:00:00Z'], now)).toBeNull();
  });
  it('24 h exactly is kept, past it is broken', () => {
    expect(replyBroken(24)).toBe(false);
    expect(replyBroken(24.01)).toBe(true);
    expect(replyBroken(null)).toBe(false);
  });
  it('median reply time', () => {
    expect(medianReplyHours([
      { reportAt: '2026-11-01T00:00:00Z', replyAt: '2026-11-01T02:00:00Z' },
      { reportAt: '2026-11-02T00:00:00Z', replyAt: '2026-11-02T06:00:00Z' },
    ])).toBe(4);
    expect(medianReplyHours([])).toBeNull();
  });
});

describe('contact every 7 days', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  it('7 days kept, 8 broken, never broken', () => {
    expect(contactBroken(daysSinceContact('2026-11-14T12:00:00Z', now))).toBe(false);
    expect(contactBroken(daysSinceContact('2026-11-13T11:00:00Z', now))).toBe(true);
    expect(contactBroken(daysSinceContact(null, now))).toBe(true);
  });
});

describe('counting — one function for coach and manager', () => {
  const now = new Date('2026-11-28T19:00:00Z');
  const rows = [
    { athleteId: 'a', coachIds: ['y'], paused: false, hasNextPlan: false, waitingHours: 30, daysSinceContact: 2 },
    { athleteId: 'b', coachIds: ['y', 'd'], paused: false, hasNextPlan: true, waitingHours: null, daysSinceContact: 9 },
    { athleteId: 'c', coachIds: ['d'], paused: true, hasNextPlan: false, waitingHours: null, daysSinceContact: 30 },
  ].map((t) => ({ ...traineePromises(t, '2026-11-29', now), coachIds: t.coachIds }));
  it('paused owes no plan or contact', () => {
    expect(rows[2]).toMatchObject({ plan: 'ready', contactLate: false });
  });
  it('totals and per-coach', () => {
    const c = countPromises(rows);
    expect(c).toMatchObject({ noNextPlan: 1, replyLate: 1, contactLate: 1, total: 3 });
    expect(c.byCoach).toEqual({ y: 3, d: 1 });
  });
});

describe('capacity', () => {
  it('defaults and states', () => {
    expect(capacityOf(null)).toBe(DEFAULT_CAPACITY);
    expect(capacityOf(0)).toBe(DEFAULT_CAPACITY);
    expect(loadState(6, 8)).toBe('open');
    expect(loadState(7, 8)).toBe('near');
    expect(loadState(8, 8)).toBe('full');
    expect(loadState(9, 8)).toBe('over');
  });
  it('refuses over cap unless forced; a coach already on the trainee takes no new seat', () => {
    const loads = { r: { active: 8, capacity: 8 }, y: { active: 6, capacity: 8 } };
    expect(checkAssignment(['r'], [], loads)).toMatchObject({ ok: false, overCap: ['r'] });
    expect(checkAssignment(['r'], [], loads, true).ok).toBe(true);
    expect(checkAssignment(['r'], ['r'], loads)).toMatchObject({ ok: true, nearCap: ['r'] });
    expect(checkAssignment(['y'], [], loads)).toMatchObject({ ok: true, nearCap: ['y'] });
    expect(checkAssignment([], [], loads).ok).toBe(false);
  });
});

describe('trainee self-report', () => {
  it('validates', () => {
    expect(parseSelfReport({ workoutDate: '2026-11-18', rpe: 7, effort: 'right' }).ok).toBe(true);
    expect(parseSelfReport({ workoutDate: '2026-11-18', rpe: 11 }).ok).toBe(false);
    expect(parseSelfReport({ workoutDate: '18.11', rpe: 5 }).ok).toBe(false);
    expect(parseSelfReport({ workoutDate: '2026-11-18', rpe: 5, effort: 'meh' }).ok).toBe(false);
    expect(parseSelfReport({ workoutDate: '2026-11-18', rpe: 5, pain: true, painArea: 'elbow' }).ok).toBe(false);
  });
  it('drops pain detail without pain, ignores identity in the body', () => {
    const r = parseSelfReport({ workoutDate: '2026-11-18', rpe: 5, pain: false, painArea: 'knee', athleteId: 'x' });
    expect(r.ok && r.report.painArea).toBeNull();
    expect(r.ok && 'athleteId' in r.report).toBe(false);
  });
  it('flags pain / too hard / rpe ≥ 9', () => {
    expect(reportNeedsCoach({ pain: true, rpe: 3, effort: 'easy' })).toBe(true);
    expect(reportNeedsCoach({ pain: false, rpe: 9, effort: 'hard' })).toBe(true);
    expect(reportNeedsCoach({ pain: false, rpe: 6, effort: 'right' })).toBe(false);
  });
});

describe('benchmark → proposed zones', () => {
  it('7:41 for 2000 m → 3:50.5/km base', () => {
    const z = proposedZones(461)!;
    expect(z.find((x) => x.name === 'interval')).toEqual({ name: 'interval', fromSec: 236, toSec: 246 });
    expect(z).toHaveLength(4);
  });
  it('implausible → null; offset is faster-negative', () => {
    expect(proposedZones(100)).toBeNull();
    expect(repaceOffset(478, 461)).toBe(-8);
    expect(repaceOffset(null, 461)).toBeNull();
  });
});

describe('hub views', () => {
  const base = { isSuperUser: false, isStaff: false, isManager: false, isTrainee: false };
  it('narrows, never widens', () => {
    expect(resolveHubView('manager', { ...base, isStaff: true })).toBe('coach');
    expect(resolveHubView('manager', { ...base, isTrainee: true })).toBe('trainee');
    expect(resolveHubView('coach', { ...base, isTrainee: true })).toBe('trainee');
    expect(resolveHubView(null, { ...base })).toBeNull();
  });
  it('manager who coaches lands on manager and may switch', () => {
    const c = { ...base, isStaff: true, isManager: true };
    expect(resolveHubView(null, c)).toBe('manager');
    expect(resolveHubView('coach', c)).toBe('coach');
    expect(availableViews(c)).toEqual(['manager', 'coach']);
  });
  it('aggregates', () => {
    expect(pipeline([
      { coachIds: ['y'], hasAnyPlan: true, paused: false },
      { coachIds: ['y'], hasAnyPlan: false, paused: false },
      { coachIds: [], hasAnyPlan: false, paused: true },
    ], 6)).toEqual({ registered: 6, assignedNoPlan: 1, active: 1, paused: 1 });
    expect(executionPct(21, 25)).toBe(84);
    expect(executionPct(0, 0)).toBeNull();
    expect(roundBuckets([461, 470, 500, 0])).toEqual([{ fromSec: 450, count: 2 }, { fromSec: 480, count: 1 }]);
  });
});
