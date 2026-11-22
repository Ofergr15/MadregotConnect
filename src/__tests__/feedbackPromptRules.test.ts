import { describe, expect, it } from 'vitest';
import { easyIsSampled, mutedUntil, plannedKindOf, shouldAskFeedback, type PromptHistoryRow } from '@/lib/feedback/prompt-rules';

const now = new Date('2026-11-21T09:00:00Z');
const ctx = (o: Partial<Parameters<typeof shouldAskFeedback>[3]> = {}) =>
  ({ now, israelHour: 11, israelDate: '2026-11-21', availability: 'active' as const, ...o });
const run = (km = 12) => ({ activityId: 'x', distanceKm: km });
const h = (o: Partial<PromptHistoryRow>): PromptHistoryRow => ({ createdAt: '2026-11-20T08:00:00Z', mode: 'card', plannedKind: 'quality', pushed: false, ...o });

describe('shouldAskFeedback', () => {
  it('quality: card + push', () => {
    expect(shouldAskFeedback(run(), { kind: 'quality' }, [], ctx())).toMatchObject({ mode: 'card', push: true });
  });
  it('long ≥ 18 km pushes; shorter long is card only', () => {
    expect(shouldAskFeedback(run(18), { kind: 'long' }, [], ctx()).push).toBe(true);
    expect(shouldAskFeedback(run(16), { kind: 'long' }, [], ctx())).toMatchObject({ mode: 'card', push: false });
  });
  it('easy: never a push, quiet card 1 in 4', () => {
    const easyNone = (i: number) => h({ createdAt: `2026-11-1${i}T08:00:00Z`, plannedKind: 'easy', mode: 'none' });
    expect(shouldAskFeedback(run(), { kind: 'easy' }, [easyNone(1), easyNone(2)], ctx()).mode).toBe('none');
    const d = shouldAskFeedback(run(), { kind: 'easy' }, [easyNone(1), easyNone(2), easyNone(3)], ctx());
    expect(d).toMatchObject({ mode: 'quiet', push: false });
    expect(easyIsSampled([h({ plannedKind: 'easy', mode: 'quiet', createdAt: '2026-11-20T00:00:00Z' })])).toBe(false);
  });
  it('unplanned and other: nothing', () => {
    expect(shouldAskFeedback(run(), { kind: null }, [], ctx()).mode).toBe('none');
    expect(shouldAskFeedback(run(), { kind: 'other' }, [], ctx()).mode).toBe('none');
  });
  it('never while injured or paused', () => {
    for (const availability of ['injured', 'paused'] as const) {
      expect(shouldAskFeedback(run(), { kind: 'quality' }, [], ctx({ availability }))).toMatchObject({ mode: 'none', push: false });
    }
  });
  it('one push a day', () => {
    const d = shouldAskFeedback(run(), { kind: 'quality' }, [h({ pushed: true, pushedOn: '2026-11-21', createdAt: '2026-11-21T05:00:00Z' })], ctx());
    expect(d).toMatchObject({ mode: 'card', push: false, held: 'daily_cap' });
  });
  it('quiet hours 22:00–07:00 hold the push, keep the card', () => {
    expect(shouldAskFeedback(run(), { kind: 'quality' }, [], ctx({ israelHour: 22 })).held).toBe('quiet_hours');
    expect(shouldAskFeedback(run(), { kind: 'quality' }, [], ctx({ israelHour: 6 })).held).toBe('quiet_hours');
    expect(shouldAskFeedback(run(), { kind: 'quality' }, [], ctx({ israelHour: 7 })).push).toBe(true);
  });
  it('two skips in a row mute pushes for 7 days; cards still show', () => {
    const skips = [
      h({ pushed: true, pushedOn: '2026-11-18', createdAt: '2026-11-18T08:00:00Z', dismissedAt: '2026-11-18T09:00:00Z' }),
      h({ pushed: true, pushedOn: '2026-11-16', createdAt: '2026-11-16T08:00:00Z' }), // unanswered > 24 h
    ];
    expect(mutedUntil(skips, now)?.toISOString()).toBe('2026-11-25T09:00:00.000Z');
    expect(shouldAskFeedback(run(), { kind: 'quality' }, skips, ctx())).toMatchObject({ mode: 'card', push: false, held: 'muted' });
    expect(mutedUntil(skips, new Date('2026-11-26T00:00:00Z'))).toBeNull();
  });
  it('an answered push breaks the skip run', () => {
    const rows = [
      h({ pushed: true, createdAt: '2026-11-18T08:00:00Z', answeredAt: '2026-11-18T09:00:00Z' }),
      h({ pushed: true, createdAt: '2026-11-16T08:00:00Z', dismissedAt: '2026-11-16T09:00:00Z' }),
    ];
    expect(mutedUntil(rows, now)).toBeNull();
  });
});

describe('plannedKindOf', () => {
  it('maps plan facts', () => {
    expect(plannedKindOf('quality', 14, false)).toBe('quality');
    expect(plannedKindOf('easy', 20, false)).toBe('long');
    expect(plannedKindOf('other', 10, true)).toBe('long');
    expect(plannedKindOf('easy', 8, false)).toBe('easy');
    expect(plannedKindOf(null, 0, false)).toBeNull();
  });
});
