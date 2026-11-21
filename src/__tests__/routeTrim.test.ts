import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { haversineM, routeForViewer, seesFullRoute, trimRouteEnds, ROUTE_TRIM_M } from '@/lib/privacy/route-trim';
import { projectFeedItem } from '@/lib/feed/project';

// A straight line north, one point every ~50 m (0.00045° lat ≈ 50 m), 2 km long.
const line = Array.from({ length: 41 }, (_, i) => ({ lat: 32 + i * 0.00045, lng: 34.8 }));
const along = (pts: typeof line, p: { lat: number; lng: number }) => haversineM(pts[0], p);

describe('trimRouteEnds — the start/finish privacy zone', () => {
  it('drops everything within 200 m (along the track) of the start and of the finish', () => {
    const t = trimRouteEnds(line)!;
    const total = along(line, line[line.length - 1]);
    expect(t.length).toBeGreaterThan(1);
    for (const p of t) {
      expect(along(line, p)).toBeGreaterThan(ROUTE_TRIM_M);
      expect(total - along(line, p)).toBeGreaterThan(ROUTE_TRIM_M);
    }
    expect(t[0]).not.toEqual(line[0]);
    expect(t[t.length - 1]).not.toEqual(line[line.length - 1]);
  });

  it('a loop that ends at its own start loses both ends (distance is along the track, not from the endpoint)', () => {
    const loop = [...line, ...[...line].reverse().slice(1)];
    const t = trimRouteEnds(loop)!;
    for (const p of t) expect(haversineM(loop[0], p)).toBeGreaterThan(ROUTE_TRIM_M - 1);
  });

  it('a route of 400 m or less has no middle and trims to nothing', () => {
    expect(trimRouteEnds(line.slice(0, 8))).toBeNull(); // ~350 m
    expect(trimRouteEnds([])).toBeNull();
    expect(trimRouteEnds(null)).toBeNull();
  });
});

describe('who sees the whole trace', () => {
  it('the runner and staff do; another member does not', () => {
    expect(seesFullRoute({ athleteId: 'a', isStaff: false }, 'a')).toBe(true);
    expect(seesFullRoute({ athleteId: 'b', isStaff: true }, 'a')).toBe(true);
    expect(seesFullRoute({ athleteId: null, isStaff: false, isSuperUser: true }, 'a')).toBe(true);
    expect(seesFullRoute({ athleteId: 'b', isStaff: false }, 'a')).toBe(false);
    expect(seesFullRoute({ athleteId: null, isStaff: false }, 'a')).toBe(false);
  });
  it('routeForViewer hands the owner the untouched array and a teammate the trimmed one', () => {
    expect(routeForViewer(line, { athleteId: 'a', isStaff: false }, 'a')).toBe(line);
    expect(routeForViewer(line, { athleteId: 'b', isStaff: false }, 'a')!.length).toBeLessThan(line.length);
  });
});

describe('the feed projection applies it server-side', () => {
  const row = {
    id: 'f1', type: 'activity', author_athlete_id: 'runner', body: null, media: [], payload: null,
    occurred_at: '2026-11-20T06:00:00Z', like_count: 0, comment_count: 0,
    athletes: { id: 'runner', name: 'R', avatar_url: null, groups: null },
    athlete_activities: {
      id: 'act1', athlete_id: 'runner', garmin_activity_id: null, activity_name: 'Run', activity_type: 'running',
      start_time: '2026-11-20T06:00:00Z', distance: 2000, duration: 600, route_preview: line, route_preview_hd: null,
      has_polyline: true, splits: null, laps: null,
    },
  };
  const ctx = (viewerAthleteId: string | null, viewerIsStaff = false) => ({ viewerAthleteId, viewerIsStaff, likedItemIds: new Set<string>() });

  it('a teammate never receives the first or last point', () => {
    const r = projectFeedItem(row, ctx('teammate')).activity!.routePreview!;
    expect(r.length).toBeLessThan(line.length);
    expect(r).not.toContainEqual(line[0]);
    expect(r).not.toContainEqual(line[line.length - 1]);
  });
  it('the runner and staff get the whole route', () => {
    expect(projectFeedItem(row, ctx('runner')).activity!.routePreview).toHaveLength(line.length);
    expect(projectFeedItem(row, ctx('coach', true)).activity!.routePreview).toHaveLength(line.length);
  });
  it('a route too short to have a middle ships no map at all to a teammate', () => {
    const short = { ...row, athlete_activities: { ...row.athlete_activities, route_preview: line.slice(0, 6), has_polyline: true } };
    const a = projectFeedItem(short, ctx('teammate')).activity!;
    expect(a.routePreview).toBeNull();
    expect(a.hasRoute).toBe(false);
  });
});

describe('every member-reachable route-carrying response goes through the trim', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it.each([
    'src/app/api/activities/details/route.ts',
    'src/app/api/feed/items/[id]/route.ts',
    'src/app/api/athletes/[id]/runs/route.ts',
  ])('%s', (p) => {
    expect(src(p)).toMatch(/routeForViewer\(/);
  });
  it('the detail route never returns gps_points untouched', () => {
    expect(src('src/app/api/activities/details/route.ts')).not.toMatch(/gpsPoints: gps_points \|\| \[\]/);
  });
});

import { groupFeedItems } from '@/lib/feed/group-runs';
describe('the run-together group card draws only what the projection shipped', () => {
  const base = (id: string, athlete: string) => ({
    id, type: 'activity', author_athlete_id: athlete, body: null, media: [], payload: null,
    occurred_at: '2026-11-20T06:00:00Z', like_count: 0, comment_count: 0,
    athletes: { id: athlete, name: athlete, avatar_url: null, groups: null },
    athlete_activities: {
      id: `act-${id}`, athlete_id: athlete, garmin_activity_id: null, activity_name: 'Run', activity_type: 'running',
      start_time: '2026-11-20T06:00:00Z', distance: 2000, duration: 600, route_preview: line, route_preview_hd: null,
      has_polyline: true, splits: null, laps: null,
    },
  });
  it('groups two teammates on trimmed routes, and no member\'s start or finish reaches the viewer', () => {
    const ctx = { viewerAthleteId: 'viewer', viewerIsStaff: false, likedItemIds: new Set<string>() };
    const items = [projectFeedItem(base('f1', 'a'), ctx), projectFeedItem(base('f2', 'b'), ctx)];
    const entries = groupFeedItems(items, 'viewer');
    const group = entries.find((e) => e.kind === 'group');
    expect(group).toBeTruthy();
    const json = JSON.stringify(entries);
    expect(json).not.toContain(JSON.stringify(line[0]).slice(1, -1));
    expect(json).not.toContain(JSON.stringify(line[line.length - 1]).slice(1, -1));
  });
});

describe('the other non-owner trace routes', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('the birthday story trims the run of the year for a teammate', () => {
    expect(src('src/app/api/birthday-year/route.ts')).toMatch(/routeForViewer\(story\.stats\.moment\.route/);
  });
  it('"how members see me": ?as=member drops the owner-only reads (wellness) for the owner', () => {
    const s = src('src/app/api/athletes/[id]/stats/route.ts');
    expect(s).toMatch(/const self = caller\.athleteId === id && new URL\(request\.url\)\.searchParams\.get\('as'\) !== 'member'/);
    expect(s).toMatch(/self \? readWellnessNights/);
    // The native caller lives on native-ios only; the server-only branch has no ios/.
    const swift = 'ios/Madregot/Features/Profile/TeammateProfile.swift';
    if (existsSync(swift)) expect(src(swift)).toMatch(/"as": "member"/);
  });
});
