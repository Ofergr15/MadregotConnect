import { describe, expect, it } from 'vitest';
import { suggestPaceGroup, volumePenalty, parseDistanceM, nearestGroup } from '@/lib/events/pace-groups';
import { effectiveStatus, projectEvents, normaliseBlocks, publishPatch, editTarget } from '@/lib/events/lifecycle';

const M = 42195;
const groups = [
  { id: 'g259', label: '2:59', targetPaceSecPerKm: 254 },
  { id: 'g315', label: '3:15', targetPaceSecPerKm: 277 },
  { id: 'g330', label: '3:30', targetPaceSecPerKm: 299 },
];
const now = new Date('2026-11-21T10:00:00Z');

describe('suggestPaceGroup', () => {
  it('goal only → nearest group', () => {
    const s = suggestPaceGroup({ eventDistanceM: M, goalBand: { minSec: 10680, maxSec: 10800 }, groups });
    expect(s.groupId).toBe('g259');
    expect(s.mismatch).toBe(false);
  });
  it('flags >2% mismatch and takes the slower time', () => {
    // HM 1:35:00 → Riegel ≈ 3:18 marathon; goal 2:59
    const s = suggestPaceGroup({ eventDistanceM: M, goalBand: { minSec: 10680, maxSec: 10800 }, latestResult: { distanceM: 21097.5, timeSec: 5700 }, avgWeeklyKm8w: 80, groups });
    expect(s.mismatch).toBe(true);
    expect(s.suggestedSec).toBe(s.impliedSec);
    expect(s.groupId).toBe('g315');
  });
  it('within 2% keeps the runner goal', () => {
    const s = suggestPaceGroup({ eventDistanceM: M, goalBand: { minSec: 11800, maxSec: 11900 }, latestResult: { distanceM: 21097.5, timeSec: 5700 }, avgWeeklyKm8w: 80, groups });
    expect(s.mismatch).toBe(false);
    expect(s.suggestedSec).toBe(11850);
  });
  it('volume penalty only for marathon-length, capped at 6%', () => {
    expect(volumePenalty(21097.5, 10)).toBe(0);
    expect(volumePenalty(M, 60)).toBeCloseTo(0.01);
    expect(volumePenalty(M, 0)).toBe(0.06);
  });
  it('no data → no suggestion', () => {
    expect(suggestPaceGroup({ eventDistanceM: M, groups }).groupId).toBeNull();
  });
  it('tie goes to the slower group', () => {
    const g = [{ id: 'a', label: 'a', targetPaceSecPerKm: 200 }, { id: 'b', label: 'b', targetPaceSecPerKm: 300 }];
    expect(nearestGroup(g, 250 * 10, 10000)?.id).toBe('b');
  });
  it('parses distances', () => {
    expect(parseDistanceM('42.2K')).toBe(M);
    expect(parseDistanceM('חצי מרתון')).toBe(21097.5);
    expect(parseDistanceM('10K')).toBe(10000);
    expect(parseDistanceM('')).toBeNull();
  });
});

describe('lifecycle', () => {
  it('pre-migration rows are published', () => expect(effectiveStatus({}, now)).toBe('published'));
  it('scheduled goes live at publish_at', () => {
    expect(effectiveStatus({ status: 'scheduled', publish_at: '2026-11-21T09:00:00Z' }, now)).toBe('published');
    expect(effectiveStatus({ status: 'scheduled', publish_at: '2026-11-22T09:00:00Z' }, now)).toBe('scheduled');
  });
  it('members never see drafts or pending', () => {
    const rows = [{ id: 1, status: 'draft' }, { id: 2, status: 'published', pending: { fields: {} } }];
    const m = projectEvents(rows, false, now);
    expect(m.map((r) => r.id)).toEqual([2]);
    expect('pending' in m[0]).toBe(false);
    expect(projectEvents(rows, true, now)).toHaveLength(2);
  });
  it('normalises blocks', () => {
    const b = normaliseBlocks([{ kind: 'route' }, { kind: 'nope' }, { kind: 'free_text', enabled: false }])!;
    expect(b.map((x) => [x.kind, x.position, x.enabled])).toEqual([['route', 0, true], ['free_text', 1, false]]);
  });
  it('edits to a live event go to pending; publish applies them', () => {
    expect(editTarget({ status: 'published' }, now)).toBe('pending');
    expect(editTarget({ status: 'draft' }, now)).toBe('live');
    const r = publishPatch({ status: 'published', version: 2, pending: { fields: { name: 'x' } } }, 'now', null, now);
    expect('patch' in r && r.patch).toMatchObject({ name: 'x', version: 3, pending: null });
    expect(publishPatch({ status: 'draft' }, 'schedule', '2026-11-20T00:00:00Z', now)).toHaveProperty('error');
  });
});
