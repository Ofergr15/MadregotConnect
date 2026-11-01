import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
import { isManualPlan, withoutOwnRows } from '@/lib/plans/scope-server';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// add_personal_workout (migration 176): a week written by hand for one athlete. It has to
// reach that athlete whether or not they are in the academy, and nobody else.
describe('manual personal week', () => {
  const club = { athlete_id: null, parsed_workouts: { workouts: [] } };
  const manual = { athlete_id: 'me', parsed_workouts: { workouts: [], manual: true } };
  const academy = { athlete_id: 'me', parsed_workouts: { workouts: [] } };

  it('is recognised only by the manual flag on the blob', () => {
    expect(isManualPlan(manual)).toBe(true);
    expect(isManualPlan(academy)).toBe(false);
    expect(isManualPlan(club)).toBe(false);
    expect(isManualPlan({ parsed_workouts: null })).toBe(false);
    expect(isManualPlan(null)).toBe(false);
  });

  it('survives for an athlete outside the academy, where an academy row does not', () => {
    expect(withoutOwnRows([club, manual, academy], false)).toEqual([club, manual]);
    expect(withoutOwnRows([club, manual, academy], true)).toEqual([club, manual, academy]);
  });

  it('is what "send to watch" sends, read only for the caller', () => {
    const src = read('src/lib/watch/own-week.ts');
    expect(src).toMatch(/\.eq\('athlete_id', athleteId\)/);
    expect(src).toMatch(/find\(isManualPlan\)/);
    expect(src).toMatch(/plan: manual \|\| plan/);
  });

  it('migration: one athlete by email, raises on a miss, not callable over REST', () => {
    const sql = read('supabase/migrations/176_add_personal_workout.sql');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION add_personal_workout\(p_email text, p_date date, p_workouts jsonb\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'add_personal_workout: no athlete/);
    expect(sql).toMatch(/'manual', true/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION add_personal_workout\(text, date, jsonb\) FROM anon, authenticated/);
    expect(sql).not.toMatch(/is_academy/);
  });
});
