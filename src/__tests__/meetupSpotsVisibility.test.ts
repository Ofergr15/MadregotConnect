import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { clubSpots } from '@/lib/runs/together-server';

/**
 * GET /api/runs/meetups `spots` (the post sheet's place suggestions). Owner-approved scope
 * 2026-11-21: a past run's named place must never reach a viewer who may not see that run.
 *
 * Run-together v3 (migration 190) closes this by construction: suggestions are the club's
 * curated `run_spots` only (pre-190: the hardcoded CLUB_SPOTS), and no past run's place is
 * read at all. These tests pin that — if a future change starts suggesting places from past
 * runs again, it has to bring back the per-viewer visibility filter (meetupVisibleTo).
 * Synthetic names and coordinates only.
 */
function fakeDb(rows: unknown[] | null, error: unknown = null) {
  const touched: string[] = [];
  const b: any = { select: () => b, eq: () => b, order: async () => ({ data: rows, error }) };
  return { touched, db: { from: (t: string) => { touched.push(t); return b; } } as any };
}

describe('runs/meetups — place suggestions never come from past runs', () => {
  it('the route builds `spots` from clubSpots() alone', () => {
    const src = readFileSync('src/app/api/runs/meetups/route.ts', 'utf8');
    expect(src).toMatch(/clubSpots\(db\)/);
    expect(src).not.toMatch(/pastRows/);
    expect(src).not.toMatch(/spots\.push\(/);
  });
  it('clubSpots reads only run_spots', async () => {
    const f = fakeDb([{ id: 's1', name: 'Synthetic Spot', area_label: 'Area', lat: 31.5, lng: 35.1, area_lat: 31.5, area_lng: 35.1 }]);
    const spots = await clubSpots(f.db);
    expect(f.touched).toEqual(['run_spots']);
    expect(spots.map((s) => s.name)).toEqual(['Synthetic Spot']);
  });
  it('pre-190 / failed read: the curated hardcoded spots, never anything wider', async () => {
    const f = fakeDb(null, { message: 'relation "run_spots" does not exist' });
    const spots = await clubSpots(f.db);
    expect(f.touched).toEqual(['run_spots']);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((s) => s.id === null)).toBe(true);
  });
});
