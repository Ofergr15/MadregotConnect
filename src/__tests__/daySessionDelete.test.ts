import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

/** Deleting a one-day session (Ofer, 2026-10-18: one went out for the wrong day). */
describe('a one-day session can be deleted', () => {
  const route = readFileSync('src/app/api/day-session/route.ts', 'utf8');
  const page = readFileSync('src/app/(app)/dashboard/day-session/page.tsx', 'utf8');

  it('behind the same gate as editing, never while viewing as somebody', () => {
    const del = route.slice(route.indexOf('export async function DELETE'));
    expect(del).toMatch(/if \(!mayEditDaySession\(auth\.user\)\) return/);
    expect(del).toMatch(/auth\.user\.viewingAsBy/);
    expect(del).toMatch(/DATE\.test\(date\)/);
  });

  it('takes the session off the watches it reached too', () => {
    expect(route).toMatch(/await removeDaySessionFromWatches\(date\)/);
    const watch = readFileSync('src/lib/day-session/watch.ts', 'utf8');
    expect(watch).toMatch(/r\.workout_key === dayKey\(date\)/);
    expect(watch).toMatch(/deleteWorkout\(r\.garmin_workout_id!\)/);
  });

  it('asks first, from the form of a date that has a session', () => {
    expect(page).toMatch(/\{existing && \(\s*<button[\s\S]*?setConfirmDelete\(true\)/);
    expect(page).toMatch(/method: 'DELETE'/);
  });
});
