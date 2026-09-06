import { describe, expect, it } from 'vitest';
import {
  groupFeedItems,
  routeOverlap,
  mutualOverlap,
  optedOutOfGrouping,
  MIN_OVERLAP,
  PROXIMITY_M,
  START_TOLERANCE_S,
} from '@/lib/feed/group-runs';
import type { FeedItem } from '@/lib/feed/project';

/**
 * A straight line of points 111 m apart, starting at `lat0`. Enough to stand in
 * for a route: the detector only ever asks "is this point near that one".
 */
function line(lat0: number, count: number, lng = 34.78) {
  return Array.from({ length: count }, (_, i) => ({ lat: lat0 + i * 0.001, lng }));
}

const TEL_AVIV = line(32.08, 20);
const HAIFA = line(32.79, 20, 34.99);

interface RunOpts {
  id: string;
  athleteId: string;
  startTime: string;
  route?: Array<{ lat: number; lng: number }> | null;
  distance?: number;
  averagePace?: number | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: string;
  name?: string;
}

function run(opts: RunOpts): FeedItem {
  const route = opts.route === undefined ? TEL_AVIV : opts.route;
  return {
    id: opts.id,
    type: 'activity',
    author: {
      athleteId: opts.athleteId,
      name: opts.name || opts.athleteId,
      avatarUrl: null,
      groupName: 'קבוצה 1',
    },
    body: null,
    media: [],
    payload: opts.payload ?? null,
    occurredAt: opts.occurredAt || opts.startTime,
    likeCount: 0,
    commentCount: 0,
    likedByMe: false,
    likePreview: [],
    commentPreview: [],
    canDelete: false,
    activity: {
      id: `act-${opts.id}`,
      athleteId: opts.athleteId,
      garminActivityId: null,
      activityName: 'Morning run',
      activityType: 'running',
      startTime: opts.startTime,
      distance: opts.distance ?? 10_000,
      duration: 3000,
      movingDuration: null,
      averagePace: opts.averagePace === undefined ? 300 : opts.averagePace,
      averageHr: null,
      maxHr: null,
      calories: null,
      elevationGain: null,
      locationName: null,
      perceivedRpe: null,
      perceivedFeel: null,
      routePreview: route,
      hasRoute: !!route,
      paceBands: null,
      planVerdict: null,
    },
  } as FeedItem;
}

function post(id: string): FeedItem {
  return {
    id,
    type: 'post',
    author: { athleteId: 'someone', name: 'Someone', avatarUrl: null, groupName: null },
    body: 'hello',
    media: [],
    payload: null,
    occurredAt: '2026-09-01T09:00:00',
    likeCount: 0,
    commentCount: 0,
    likedByMe: false,
    likePreview: [],
    commentPreview: [],
    canDelete: false,
    activity: null,
  } as FeedItem;
}

describe('routeOverlap', () => {
  it('is 1 for the same route and 0 for routes in different cities', () => {
    expect(routeOverlap(TEL_AVIV, TEL_AVIV)).toBe(1);
    expect(routeOverlap(TEL_AVIV, HAIFA)).toBe(0);
  });

  it('is asymmetric, which is why the detector probes the shorter route', () => {
    // Someone who joined for the last stretch of a longer run.
    const joiner = TEL_AVIV.slice(-4);
    expect(routeOverlap(joiner, TEL_AVIV)).toBe(1);
    expect(routeOverlap(TEL_AVIV, joiner)).toBeLessThan(MIN_OVERLAP);
  });

  it('mutualOverlap takes the smaller share, so a subset does not score 100%', () => {
    const joiner = TEL_AVIV.slice(-4);
    expect(mutualOverlap(TEL_AVIV, TEL_AVIV)).toBe(1);
    // 4/4 one way, 6/20 the other (two of ofer's points sit within PROXIMITY_M of
    // the joiner's start). The smaller one is what "together" means.
    expect(mutualOverlap(joiner, TEL_AVIV)).toBeLessThan(MIN_OVERLAP);
    expect(mutualOverlap(joiner, TEL_AVIV)).toBe(mutualOverlap(TEL_AVIV, joiner));
    expect(mutualOverlap(TEL_AVIV, HAIFA)).toBe(0);
  });

  it('the threshold is 80% of each run, not half of the shorter one', () => {
    expect(MIN_OVERLAP).toBe(0.8);
  });

  it('counts a point as near within PROXIMITY_M', () => {
    // ~111 m north of the first point: inside the radius. ~333 m: outside.
    expect(routeOverlap([{ lat: 32.081, lng: 34.78 }], [TEL_AVIV[0]])).toBe(1);
    expect(routeOverlap([{ lat: 32.083, lng: 34.78 }], [TEL_AVIV[0]])).toBe(0);
    expect(PROXIMITY_M).toBe(250);
  });
});

describe('groupFeedItems', () => {
  it('groups two runners who ran the same route minutes apart', () => {
    const items = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:51:00' }),
    ];
    const entries = groupFeedItems(items, 'asaf');

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('group');
    const group = entries[0].kind === 'group' ? entries[0].group : null;
    expect(group!.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(group!.overlapPct).toBe(100);
    // The viewer's own run leads, so the card opens on what they came for.
    expect(group!.items[0].author.athleteId).toBe('asaf');
  });

  it('does NOT group someone who only joined for the tail — 80% has to hold both ways', () => {
    // asaf's 4 points are all on ofer's route (100% one way), but they cover a
    // fifth of it (20% the other way). Not the same run, two cards.
    const items = [
      run({ id: 'long', athleteId: 'ofer', startTime: '2026-09-01T07:50:00', distance: 20_000 }),
      run({
        id: 'short',
        athleteId: 'asaf',
        startTime: '2026-09-01T07:52:00',
        route: TEL_AVIV.slice(-4),
        distance: 5_000,
      }),
    ];
    const entries = groupFeedItems(items, null);
    expect(entries.map((e) => e.kind)).toEqual(['item', 'item']);
  });

  it('still groups a run with a short solo tail, and reports the shared share', () => {
    // ofer ran on for 6 more points alone. Two of them are still within
    // PROXIMITY_M of asaf's finish, so 22 of his 26 count as shared (85%) and all
    // 20 of asaf's do (100%). Over the threshold both ways.
    const items = [
      run({
        id: 'long',
        athleteId: 'ofer',
        startTime: '2026-09-01T07:50:00',
        route: line(32.08, 26),
        distance: 12_000,
      }),
      run({ id: 'short', athleteId: 'asaf', startTime: '2026-09-01T07:52:00', distance: 10_000 }),
    ];
    const entries = groupFeedItems(items, null);
    expect(entries).toHaveLength(1);
    const group = entries[0].kind === 'group' ? entries[0].group : null;
    // The smaller of the two shares, not the flattering one.
    expect(group!.overlapPct).toBe(85);
    // The longest route wins the shared map: it never crops part of what happened.
    expect(group!.mapItem.id).toBe('long');
  });

  it('takes the transitive closure, so a chain of overlapping starts is one group', () => {
    // a↔c are 6 minutes apart — outside the tolerance — but both match b.
    const items = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:53:00' }),
      run({ id: 'c', athleteId: 'noa', startTime: '2026-09-01T07:56:00' }),
    ];
    expect(START_TOLERANCE_S).toBe(300);

    const entries = groupFeedItems(items, null);
    expect(entries).toHaveLength(1);
    const group = entries[0].kind === 'group' ? entries[0].group : null;
    expect(group!.items).toHaveLength(3);
  });

  it('never groups two runs by the same athlete', () => {
    // A paused-and-restarted watch, or a duplicate import — not company.
    const items = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      run({ id: 'a2', athleteId: 'ofer', startTime: '2026-09-01T07:51:00' }),
    ];
    expect(groupFeedItems(items, 'ofer').every((e) => e.kind === 'item')).toBe(true);
  });

  it('leaves runs with no GPS alone', () => {
    const items = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00', route: null }),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:50:00', route: null }),
    ];
    expect(groupFeedItems(items, null).every((e) => e.kind === 'item')).toBe(true);
  });

  it('does not group runs that started far apart or ran in different cities', () => {
    const farApart = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T08:10:00' }),
    ];
    expect(groupFeedItems(farApart, null).every((e) => e.kind === 'item')).toBe(true);

    const farAway = [
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:50:00', route: HAIFA }),
    ];
    expect(groupFeedItems(farAway, null).every((e) => e.kind === 'item')).toBe(true);
  });

  it('honours the per-run opt-out on the item payload', () => {
    const optedOut = run({
      id: 'b',
      athleteId: 'asaf',
      startTime: '2026-09-01T07:50:00',
      payload: { noGroupRun: true },
    });
    expect(optedOutOfGrouping(optedOut)).toBe(true);

    const items = [run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }), optedOut];
    expect(groupFeedItems(items, null).every((e) => e.kind === 'item')).toBe(true);
  });

  it('keeps a hidden pace hidden through grouping', () => {
    // The runner who hid their pace arrives from the projection with averagePace
    // already null. Grouping must not repair it from the teammate who didn't hide
    // theirs — which it cannot, because it never sees a raw activity row.
    const items = [
      run({ id: 'open', athleteId: 'ofer', startTime: '2026-09-01T07:50:00', averagePace: 288 }),
      run({ id: 'hidden', athleteId: 'asaf', startTime: '2026-09-01T07:50:00', averagePace: null }),
    ];
    const entries = groupFeedItems(items, null);
    const group = entries[0].kind === 'group' ? entries[0].group : null;
    const hidden = group!.items.find((i) => i.id === 'hidden');
    expect(hidden!.activity!.averagePace).toBeNull();
    expect(group!.items.find((i) => i.id === 'open')!.activity!.averagePace).toBe(288);
  });

  it('renders the group at its newest member and leaves everything else in place', () => {
    const items = [
      post('p1'),
      run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' }),
      post('p2'),
      run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:51:00' }),
      post('p3'),
    ];
    const entries = groupFeedItems(items, null);

    expect(entries.map((e) => (e.kind === 'group' ? 'group' : e.item.id))).toEqual([
      'p1', 'group', 'p2', 'p3',
    ]);
  });

  it('is a stable, order-independent key so a group re-forms across pages', () => {
    const a = run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' });
    const b = run({ id: 'b', athleteId: 'asaf', startTime: '2026-09-01T07:51:00' });
    const first = groupFeedItems([a, b], null)[0];
    const second = groupFeedItems([b, a], null)[0];
    const keyOf = (e: typeof first) => (e.kind === 'group' ? e.group.key : null);
    expect(keyOf(first)).toBe(keyOf(second));
  });

  it('passes a lone run straight through', () => {
    const entries = groupFeedItems([run({ id: 'a', athleteId: 'ofer', startTime: '2026-09-01T07:50:00' })], null);
    expect(entries).toEqual([{ kind: 'item', item: expect.objectContaining({ id: 'a' }) }]);
  });
});
