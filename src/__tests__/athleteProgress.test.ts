import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fullPlanHref, progressParts } from '@/lib/athletes/progress-parts';
import { isAcademyOnly, rowsForReader } from '@/lib/plans/scope';

/**
 * The club runner's progress, reused for academy trainees (Ofer, 2026-10-19: "draw on what
 * regular trainees already have — don't reinvent the wheel").
 */
describe('progressParts — who sees which part', () => {
  it('the owner and staff get the improvement card; a teammate does not (its API is self-or-staff)', () => {
    expect(progressParts('a', 'owner').improvement).toBe(true);
    expect(progressParts('a', 'staff').improvement).toBe(true);
    expect(progressParts('a', 'peer').improvement).toBe(false);
  });
  it('everyone gets the week, the records and the last three runs', () => {
    for (const v of ['owner', 'staff', 'peer'] as const) {
      expect(progressParts('a', v)).toMatchObject({ week: true, records: true, runs: true, runsMax: 3 });
    }
  });
  it('"לכל הריצות" opens your own profile, or the athlete\'s', () => {
    expect(progressParts('a', 'owner').runsHref).toBe('/dashboard/profile');
    expect(progressParts('11111111-1111-4111-8111-111111111111', 'staff').runsHref).toContain('11111111-1111-4111-8111-111111111111');
  });
});

describe('an academy-only trainee\'s week is only their own', () => {
  const club = { athlete_id: null, status: 'pushed' };
  const own = { athlete_id: 't1', status: 'pushed' };
  it('is academy-only only with a READ null group', () => {
    expect(isAcademyOnly({ is_academy: true, group_id: null })).toBe(true);
    expect(isAcademyOnly({ is_academy: true, group_id: 'g' })).toBe(false);
    expect(isAcademyOnly({ is_academy: true })).toBe(false);
    expect(isAcademyOnly({ is_academy: false, group_id: null })).toBe(false);
    expect(isAcademyOnly(null)).toBe(false);
  });
  it('drops the club rows for them, and keeps them for everyone else', () => {
    expect(rowsForReader([club, own], 't1', true)).toEqual([own]);
    expect(rowsForReader([club], 't1', true)).toEqual([]);
    expect(rowsForReader([club, own], 't1', false)).toEqual([club, own]);
  });
  it('the week route applies it to "my week" and to the coach\'s academy read, and skips club day sessions', () => {
    const route = readFileSync('src/app/api/plans/week/route.ts', 'utf8');
    expect(route).toMatch(/rowsForReader\(withoutOwnRows\(rowsRaw, ownCounts\), whose, academyOnly\)/);
    expect(route).toMatch(/academyOnly \? \[\] : await daySessionWorkouts/);
  });
});

describe('the trainee screens reuse the runner\'s cards', () => {
  it('the trainee page, the progress tab and the trainee home mount the shared components', () => {
    expect(readFileSync('src/components/academy/MemberSheet.tsx', 'utf8')).toMatch(/<AthleteProgress[\s\S]*viewer="staff"/);
    expect(readFileSync('src/app/(app)/dashboard/academy/progress/page.tsx', 'utf8')).toMatch(/<AthleteProgress/);
    expect(readFileSync('src/components/trainee/TraineeToday.tsx', 'utf8')).toMatch(/<HomeToday athleteId=\{athleteId\} href="\/dashboard\/academy\/progress"/);
    expect(readFileSync('src/components/academy/TraineeHeader.tsx', 'utf8')).not.toMatch(/KmChart/);
  });
});

describe('"לתוכנית המלאה" on the week card', () => {
  it('opens an academy-only trainee\'s own academy week, and the club program for everyone else', () => {
    expect(fullPlanHref({ owner: true, academyOnly: true })).toBe('/dashboard/academy/week');
    expect(fullPlanHref({ owner: true, academyOnly: false })).toBe('/dashboard/program');
    expect(fullPlanHref({ owner: false, academyOnly: true })).toBe('/dashboard/program');
  });
  it('the card uses it for both of its program links', () => {
    const card = readFileSync('src/components/profile/MyWeekCard.tsx', 'utf8');
    expect(card).not.toMatch(/href="\/dashboard\/program"/);
    expect(card.match(/href=\{planHref\}/g)?.length).toBe(2);
  });
});
