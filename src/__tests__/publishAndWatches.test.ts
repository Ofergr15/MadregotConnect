import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Publish and send to the watches as one act (2026-10-20, Ofer: "what's the
 * difference between sending to the watch and publishing?" — they were two buttons
 * for one thing). Source assertions: the planner is one 2,600-line client page.
 */
const page = readFileSync(join(__dirname, '../app/(app)/dashboard/plan/new/page.tsx'), 'utf8');
const review = readFileSync(join(__dirname, '../components/DayByDayReview.tsx'), 'utf8');

describe('publish, and also to the watches', () => {
  it('is on by default', () => {
    expect(page).toMatch(/const \[alsoWatches, setAlsoWatches\] = useState\(true\)/);
  });
  it('after a successful publish, sends the PUBLISHED plan to every runner with Garmin, the whole week', () => {
    const pub = page.slice(page.indexOf('const publishClipboards'), page.indexOf('const loadMatchReview'));
    expect(pub).toMatch(/if \(alsoWatches\) \{[\s\S]*activeAthletes\.filter\(\(a\) => a\.hasGarmin\)[\s\S]*runPush\(withWatch, true, published\)/);
    // Only after the publish succeeded: the send sits after the plan came back.
    expect(pub.indexOf('runPush(')).toBeGreaterThan(pub.indexOf('const published ='));
  });
  it('goes through the one send the push sheet uses, which writes the status once', () => {
    expect(page).toMatch(/const executePush = async \(\) => \{[\s\S]{0,300}await runPush\(/);
    expect(page.match(/body: JSON\.stringify\(\{ plan_id: savedPlanId, status: newStatus \}\)/g)?.length).toBe(1);
  });
  it('never marks a plan "pushed" with no plan to send', () => {
    expect(page).toMatch(/if \(!savedPlanId \|\| !\(plansOverride \?\? groupedPlans\)\) return;/);
  });
  it('the review shows the switch, and the button says what it will do', () => {
    expect(review).toContain("t('alsoWatches'");
    expect(review).toContain("t('publishAndWatches')");
  });
});
