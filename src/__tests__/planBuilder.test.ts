import { describe, expect, it } from 'vitest';
import { annotatePlan, stepFlags, stripAnnotations } from '@/lib/plan-builder/provenance';
import { affectedGroups, changeMessage, diffPlans } from '@/lib/plan-builder/diff';
import { lockView } from '@/lib/plan-builder/lock';
import { classifyPushError, nextRetryAt } from '@/lib/plan-builder/push-status';
import { defaultPublishAt, shiftPaces } from '@/lib/plan-builder/schedule';
import * as C from '@/lib/plan-builder/constants';
import type { ParsedWeeklyPlan, WorkoutStep } from '@/lib/ai/types';

const step = (o: Partial<WorkoutStep> = {}): WorkoutStep => ({
  order: 1, type: 'interval', durationType: 'distance', durationValue: 1000, targetType: 'pace',
  targetPaceMinPerKm: 210, targetPaceMaxPerKm: 215, group2Pace: { min: 220, max: 225 }, group3Pace: { min: 230, max: 235 }, ...o,
});
const plan = (steps: WorkoutStep[], day = 2): ParsedWeeklyPlan => ({ workouts: [{ dayOfWeek: day, name: 'אינטרוולים', steps }] });

describe('plan builder defaults (open questions)', () => {
  it('match the approved prototype', () => {
    expect(C.planBuilderConfig()).toMatchObject({
      defaultPublishMode: 'scheduled', defaultPublishWeekday: 5, defaultPublishHourIL: 20,
      flagsBlockPublish: false, changeNoticeScope: 'affected', defaultOverwriteWatch: false,
      editLockMode: 'soft', lockTtlSec: 120, copyLastWeekPaceShiftSec: 0,
    });
  });
});

describe('provenance', () => {
  it('flags ambiguous units, pace from notes and unread steps', () => {
    expect(stepFlags(step({ notes: '50 דקות או 10 ק"מ' }))).toContain('unit_ambiguous');
    expect(stepFlags(step({ notes: '3:30 (3:40) ((3:50))' }))).toContain('pace_from_notes');
    expect(stepFlags(step({ durationValue: undefined }))).toContain('unread');
    expect(stepFlags(step())).toEqual([]);
  });
  it('reports missing days (partial parse), source rows in day order, and strips cleanly', () => {
    const p: ParsedWeeklyPlan = { workouts: [0, 1, 2, 4, 5].map((d) => ({ dayOfWeek: d, name: 'x', steps: [step({ durationValue: d === 4 ? undefined : 1000 })] })) };
    const a = annotatePlan(p);
    expect(a.missingDays).toEqual([3, 6]);
    expect(a.flagCount).toBe(1);
    expect(a.workouts[3].steps[0].source).toEqual({ page: 1, row: 3, col: null, approximate: true });
    const s = stripAnnotations(a).workouts[0].steps[0] as any;
    expect(s.flags).toBeUndefined();
    expect(s.source).toBeUndefined();
  });
});

describe('diff + scoped notice', () => {
  it('a group 3 pace change reaches group 3 only', () => {
    const c = diffPlans(plan([step()]), plan([step({ group3Pace: { min: 240, max: 245 } })]));
    expect(c).toHaveLength(1);
    expect(c[0].groups).toEqual([3]);
    expect(affectedGroups(c)).toEqual([3]);
    expect(affectedGroups(c, 'everyone')).toEqual([1, 2, 3]);
    expect(changeMessage(c)).toContain('יום ג׳ — אינטרוולים: עודכן (קצב קבוצה 3)');
  });
  it('a structural change, added and removed days reach everyone', () => {
    expect(diffPlans(plan([step()]), plan([step({ durationValue: 2000 })]))[0].groups).toEqual([1, 2, 3]);
    const c = diffPlans(plan([step()], 2), plan([step()], 3));
    expect(c.map((x) => x.kind)).toEqual(['removed', 'added']);
  });
  it('no change → no notice', () => {
    expect(diffPlans(plan([step()]), plan([step()]))).toEqual([]);
    expect(changeMessage([])).toBe('');
  });
});

describe('soft lock', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  const row = (ageSec: number, id = 'b') => ({ editor_id: id, editor_name: 'יואב', heartbeat_at: new Date(now - ageSec * 1000).toISOString() });
  it('someone else within TTL holds it; stale or mine does not block', () => {
    expect(lockView(row(30), 'a', now)).toMatchObject({ state: 'other', editorName: 'יואב', expiresInSec: 90 });
    expect(lockView(row(130), 'a', now).state).toBe('free');
    expect(lockView(row(10, 'a'), 'a', now).state).toBe('mine');
    expect(lockView(null, 'a', now).state).toBe('free');
  });
});

describe('push status', () => {
  it('maps expired auth to reconnect and 429 to backoff', () => {
    expect(classifyPushError('Garmin not connected').state).toBe('reconnect');
    expect(classifyPushError('401 Unauthorized').state).toBe('reconnect');
    expect(classifyPushError('HTTP 429 Too Many Requests')).toEqual({ state: 'backoff', code: 'rate_limited' });
    expect(classifyPushError('boom').state).toBe('failed');
  });
  it('backs off exponentially, capped', () => {
    const t = 0;
    expect(Date.parse(nextRetryAt(1, t))).toBe(60_000);
    expect(Date.parse(nextRetryAt(3, t))).toBe(240_000);
    expect(Date.parse(nextRetryAt(20, t))).toBe(30 * 60_000);
  });
});

describe('schedule', () => {
  it('defaults to Friday 20:00 Israel before the plan week, DST-aware', () => {
    expect(defaultPublishAt('2026-11-22')).toBe('2026-11-20T18:00:00.000Z'); // winter, UTC+2
    expect(defaultPublishAt('2026-07-05')).toBe('2026-07-03T17:00:00.000Z'); // summer, UTC+3
  });
  it('copy-last-week shift is a no-op at 0 and shifts every pace otherwise', () => {
    const p = plan([step()]);
    expect(shiftPaces(p, 0)).toBe(p);
    const s = shiftPaces(p, -5).workouts[0].steps[0];
    expect([s.targetPaceMinPerKm, s.group2Pace?.min, s.group3Pace?.max]).toEqual([205, 215, 230]);
  });
});
