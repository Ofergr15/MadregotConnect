/**
 * "עופר rode with אסף ועוד 4" — collapsing one club run that eight people
 * recorded separately into one card.
 *
 * ── Why this is a pure function over PROJECTED items ──────────────────────────
 * It takes `FeedItem[]` — the output of `projectFeedItem` — and never touches a
 * raw DB row. That is the whole safety argument for the feature: `maskHiddenStats`
 * has already blanked calories/HR/pace/paceBands by the time anything here runs,
 * so a runner who hid their pace cannot leak it by being grouped next to a
 * teammate who didn't. Grouping literally cannot see the values it would leak.
 * Keep it that way — if this ever needs another field, add it to the projection
 * (and to the mask if it's derived from one of the hidden ones), not to a new
 * query.
 *
 * ── Why it runs on the client, over the accumulated list ─────────────────────
 * A group can straddle a pagination boundary: five of the eight runs land on page
 * one and three on page two. Grouping per-page on the server would emit a group
 * of five and then a group of three for the same run. Running it over the whole
 * accumulated `items` array on each render re-forms the group as later pages
 * arrive. It's cheap — see the cost note on `routeOverlap`.
 *
 * ── Detection ────────────────────────────────────────────────────────────────
 * Two runs are the same run when BOTH hold:
 *   · their start times are within START_TOLERANCE_S of each other, and
 *   · at least MIN_OVERLAP of EACH route runs within PROXIMITY_M of the other.
 *
 * The second condition is deliberately mutual, and that is the whole product
 * rule: "we ran together" has to be true of both runs, not just the shorter one.
 * Someone who joined for the last 4 km of a 15 km run is 100% on your route while
 * you are only 27% on theirs — Strava calls that running together, we don't. They
 * get their own card, which is also the honest one: they didn't run your run.
 *
 * Grouping is then the transitive closure of that relation (union-find), so a
 * pack that strings out still lands on one card as long as each link holds.
 */

import type { FeedItem } from '@/lib/feed/project';

/**
 * How far apart two starts may be. Strava reports its own grouping breaking when
 * a device clock is more than a minute off network time; ±5 minutes is
 * deliberately looser, because nobody in a club start line presses Start on the
 * same second (the reference screenshot shows 7:50 against 7:51) and the cost of
 * a false positive here is one card that groups two people who happened to leave
 * the same park at the same minute AND follow the same streets — which, at a
 * hundred members, is the group run.
 */
export const START_TOLERANCE_S = 300;

/** How close counts as "together". Wide enough for opposite pavements, a lead
 *  pack stringing out, and the ~10 m of GPS noise a phone adds in a street. */
export const PROXIMITY_M = 250;

/**
 * Fraction of *each* route that must be close to the other one.
 *
 * 80%: a shared run with a bit of solo warm-up or cool-down on either end still
 * counts, half a run together does not. The cost of raising it is the odd false
 * negative — run 10 km with the group and then 3 km home alone and you are at
 * 77%, so your run splits off. That is the trade the threshold buys; drop it to
 * 0.7 if that turns out to be common in practice.
 */
export const MIN_OVERLAP = 0.8;

/** Groups only form from this many runners up. Two is a group run. */
const MIN_GROUP_SIZE = 2;

/** Fewer points than this is not a route worth matching on. */
const MIN_ROUTE_POINTS = 4;

export interface RunGroup {
  /** Stable across re-renders and across pages growing: member ids, sorted. */
  key: string;
  /**
   * Everyone on the card. The viewer's own run first if they were on it, then by
   * descending distance — so the card opens on the run the reader came for.
   */
  items: FeedItem[];
  /**
   * Whose route is drawn as the one shared map: the longest, which is the only
   * choice that never hides part of what happened. (The alternatives — first
   * runner, or whoever's feed it is — both crop the map for everyone else.)
   */
  mapItem: FeedItem;
  /** Rounded percentage of route overlap across the group, for the card's chip. */
  overlapPct: number;
}

export type FeedEntry =
  | { kind: 'item'; item: FeedItem }
  | { kind: 'group'; group: RunGroup };

// ─── geometry ──────────────────────────────────────────────────────────────────

const EARTH_R = 6_371_000;

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Box { minLat: number; maxLat: number; minLng: number; maxLng: number }

function boundingBox(pts: Array<{ lat: number; lng: number }>): Box {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of pts) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Degrees of latitude equal to PROXIMITY_M — the longitude margin is wider, and
 *  using the latitude figure for both is the conservative direction (a slightly
 *  too-generous box, then the real distance check decides). */
const PROXIMITY_DEG = PROXIMITY_M / 111_320;

function boxesDisjoint(a: Box, b: Box): boolean {
  return (
    a.minLat - PROXIMITY_DEG > b.maxLat ||
    b.minLat - PROXIMITY_DEG > a.maxLat ||
    a.minLng - PROXIMITY_DEG > b.maxLng ||
    b.minLng - PROXIMITY_DEG > a.maxLng
  );
}

/**
 * Fraction of `probe`'s points that lie within PROXIMITY_M of some point of
 * `against` — one direction only. `mutualOverlap` is what the detector uses; this
 * is the half it is built from, kept exported because the asymmetry is the thing
 * worth being able to test in isolation.
 *
 * `routePreview` is ~60 points spread evenly along the run, so "fraction of
 * points" stands in for "fraction of the run" closely enough for an 80% threshold.
 * It is not "fraction of time" — a walked kilometre carries about as many samples
 * as a fast one — but the difference cannot move a real group run across the
 * threshold.
 *
 * Cost: 60 × 60 = 3,600 distance calls per pair, and only for pairs that already
 * passed the start-time check, which on a real feed page is a handful. The
 * bounding-box test in `sameRun` throws out runs in different towns for free.
 */
export function routeOverlap(
  probe: Array<{ lat: number; lng: number }>,
  against: Array<{ lat: number; lng: number }>,
): number {
  if (probe.length === 0 || against.length === 0) return 0;
  let near = 0;
  for (const p of probe) {
    for (const q of against) {
      if (haversineM(p, q) <= PROXIMITY_M) { near += 1; break; }
    }
  }
  return near / probe.length;
}

/**
 * How much of the run the two of them actually did together: the SMALLER of the
 * two one-way overlaps.
 *
 * `routeOverlap` on its own can't answer the question, because it is asymmetric —
 * a subset of a route scores 1.0 against it no matter how short it is. Taking the
 * minimum is what makes "80% together" mean 80% of both runs, and it is also the
 * number worth showing on the card: the share of the run that both people were on.
 *
 * Computed in one pass rather than by calling `routeOverlap` twice — same 60 × 60
 * distance calls as the one-way version used to cost, both counts out of it. (No
 * early break: a point of `a` being matched doesn't tell us anything about which
 * points of `b` are matched, and that second column is the whole point here.)
 */
export function mutualOverlap(
  a: Array<{ lat: number; lng: number }>,
  b: Array<{ lat: number; lng: number }>,
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const nearA = new Uint8Array(a.length);
  const nearB = new Uint8Array(b.length);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (haversineM(a[i], b[j]) <= PROXIMITY_M) { nearA[i] = 1; nearB[j] = 1; }
    }
  }
  let countA = 0, countB = 0;
  for (const flag of nearA) countA += flag;
  for (const flag of nearB) countB += flag;
  return Math.min(countA / a.length, countB / b.length);
}

// ─── candidacy ─────────────────────────────────────────────────────────────────

interface Candidate {
  index: number;
  item: FeedItem;
  startMs: number;
  route: Array<{ lat: number; lng: number }>;
  box: Box;
  distance: number;
}

/**
 * An athlete's escape hatch, honoured before anything else runs.
 *
 * Written on the feed item's payload by the share sheet, the same jsonb the
 * hidden-stat toggles already use — so it needs no migration and no new column.
 * A club-wide "never group me" setting is the natural follow-up and does need
 * one; this is the per-run version, which is also the version someone actually
 * reaches for ("not this one, I was pacing my kid").
 */
export function optedOutOfGrouping(item: FeedItem): boolean {
  return item.payload?.noGroupRun === true;
}

function toCandidate(item: FeedItem, index: number): Candidate | null {
  if (item.type !== 'activity' || !item.activity) return null;
  if (optedOutOfGrouping(item)) return null;
  const route = item.activity.routePreview;
  // No GPS, no grouping. A treadmill run and an outdoor run that started at the
  // same minute are not the same run, and distance alone cannot tell them apart —
  // so the conservative answer is to leave both as their own cards.
  if (!route || route.length < MIN_ROUTE_POINTS) return null;
  const startMs = Date.parse(item.activity.startTime);
  if (!Number.isFinite(startMs)) return null;
  return {
    index,
    item,
    startMs,
    route,
    box: boundingBox(route),
    distance: item.activity.distance,
  };
}

/** The pairwise relation. Returns the overlap fraction, or 0 for "not together". */
function sameRun(a: Candidate, b: Candidate): number {
  if (Math.abs(a.startMs - b.startMs) > START_TOLERANCE_S * 1000) return 0;
  // Two runs by the SAME athlete at the same minute are a duplicate import or a
  // paused-and-restarted watch, not company.
  if (a.item.activity!.athleteId === b.item.activity!.athleteId) return 0;
  if (boxesDisjoint(a.box, b.box)) return 0;

  const overlap = mutualOverlap(a.route, b.route);
  return overlap >= MIN_OVERLAP ? overlap : 0;
}

// ─── union-find ────────────────────────────────────────────────────────────────

function makeUnionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i), rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };
  return { find, union };
}

// ─── the transform ─────────────────────────────────────────────────────────────

/**
 * Rewrites a feed page into a list of entries where runs done together appear
 * once, as a group, in the position of the group's newest member — so the feed's
 * newest-first order is untouched and no card jumps up the page.
 *
 * Items that don't group (posts, achievements, solo runs, opted-out runs, runs
 * with no GPS) pass through unchanged and in place.
 */
export function groupFeedItems(items: FeedItem[], viewerAthleteId: string | null): FeedEntry[] {
  const candidates: Candidate[] = [];
  for (let i = 0; i < items.length; i++) {
    const c = toCandidate(items[i], i);
    if (c) candidates.push(c);
  }
  if (candidates.length < MIN_GROUP_SIZE) {
    return items.map((item) => ({ kind: 'item' as const, item }));
  }

  const { find, union } = makeUnionFind(candidates.length);
  // Best overlap seen inside each cluster, for the card's "94% shared route" chip.
  const overlapByRoot = new Map<number, number>();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const overlap = sameRun(candidates[i], candidates[j]);
      if (overlap === 0) continue;
      union(i, j);
      const root = find(i);
      overlapByRoot.set(root, Math.max(overlapByRoot.get(root) ?? 0, overlap));
    }
  }

  // Cluster members, keyed by root. Roots can change during unions, so this is
  // resolved after all of them.
  const clusters = new Map<number, Candidate[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(candidates[i]);
    else clusters.set(root, [candidates[i]]);
  }

  // feed index -> the group that swallows it, and the index it renders at.
  const groupByAnchorIndex = new Map<number, RunGroup>();
  const swallowed = new Set<number>();

  for (const [root, members] of clusters) {
    if (members.length < MIN_GROUP_SIZE) continue;

    const anchorIndex = Math.min(...members.map((m) => m.index));
    const mapMember = members.reduce((best, m) => {
      if (m.distance > best.distance) return m;
      // Same distance: the denser trace draws the better map.
      if (m.distance === best.distance && m.route.length > best.route.length) return m;
      return best;
    }, members[0]);

    const ordered = [...members].sort((x, y) => {
      const xMine = x.item.activity!.athleteId === viewerAthleteId;
      const yMine = y.item.activity!.athleteId === viewerAthleteId;
      if (xMine !== yMine) return xMine ? -1 : 1;
      return y.distance - x.distance;
    });

    // Overlap can be unset when a cluster formed purely transitively through
    // roots that changed mid-union; the members are still together, so fall back
    // to the threshold rather than printing 0%.
    const overlap = overlapByRoot.get(root) ?? MIN_OVERLAP;

    groupByAnchorIndex.set(anchorIndex, {
      key: members.map((m) => m.item.id).sort().join('~'),
      items: ordered.map((m) => m.item),
      mapItem: mapMember.item,
      overlapPct: Math.round(overlap * 100),
    });
    for (const m of members) if (m.index !== anchorIndex) swallowed.add(m.index);
  }

  const entries: FeedEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const group = groupByAnchorIndex.get(i);
    if (group) { entries.push({ kind: 'group', group }); continue; }
    if (swallowed.has(i)) continue;
    entries.push({ kind: 'item', item: items[i] });
  }
  return entries;
}
