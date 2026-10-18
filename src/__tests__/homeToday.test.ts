import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

/** The runner's home, "היום" (Ofer, 2026-10-19, mockups/morning-1019). */
describe('the home', () => {
  const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8');
  const cards = readFileSync('src/components/home/HomeToday.tsx', 'utf8');

  it('greets instead of naming the app, and keeps the hero', () => {
    expect(page).not.toMatch(/>מדרגות<\/h1>/);
    expect(page).toMatch(/<NextWorkoutCard/);
  });

  it('shows today, my week, the race and the club — not the old strip', () => {
    expect(page).toMatch(/<HomeToday athleteId=\{athleteId\} \/>/);
    expect(page).toMatch(/<ClubToday \/>/);
    expect(page).not.toMatch(/<StatTiles/);
  });

  it('reads my week from the same payload as the profile, so they cannot disagree', () => {
    expect(cards).toMatch(/`\/api\/athletes\/\$\{athleteId\}\/stats`/);
    expect(cards).toMatch(/lane=mine/);
  });

  it('says nothing about the club before anybody has run', () => {
    expect(cards).toMatch(/if \(!data \|\| data\.runners === 0\) return null;/);
    const route = readFileSync('src/app/api/club/today/route.ts', 'utf8');
    expect(route).toMatch(/resolveVerifiedCaller/);
    expect(route).toMatch(/\.eq\('status', 'active'\)/);
  });
});
