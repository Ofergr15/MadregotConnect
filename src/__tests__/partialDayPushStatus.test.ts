import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PAGE = readFileSync(join(SRC, 'app/(app)/dashboard/plan/new/page.tsx'), 'utf8');

/**
 * A DAY IS NOT A WEEK (feedback 55ce8f11, "לא מקבל אימונים לשעון").
 *
 * On 19.09 at 17:46 the plan for 20–26.09 was sent to sixteen athletes with ONE day
 * selected — Sunday. Every request succeeded, so the plan was marked "pushed", and
 * Monday to Saturday reached nobody: workout_deliveries holds exactly one row per
 * athlete for that plan. The week before and the week after went out whole. The
 * status is the only thing on the coach's screen that could have said "not done".
 */
describe('the plan status after a push', () => {
  it('is "pushed" only when the whole week went', () => {
    expect(PAGE).toMatch(/const wholeWeek = pushDays === null;/);
    expect(PAGE).toMatch(/allSuccess && wholeWeek \? 'pushed' : anySuccess \? 'partial' : 'draft'/);
  });

  it('no longer reads success alone as a finished week', () => {
    expect(PAGE).not.toMatch(/allSuccess \? 'pushed' : anySuccess/);
  });
});
