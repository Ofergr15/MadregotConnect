import { describe, expect, it } from 'vitest';
import fs from 'fs';

// Ofer, 2026-10-12: the day-before reminder and the pack poll went out as two pushes in the
// same minute. 2026-10-20: the weekly pack poll is gone altogether ("מגיעים מחר?" asks the
// same thing), and a club poll published shortly before the day-before push rides inside it.
const tick = fs.readFileSync('src/app/api/cron/tick/route.ts', 'utf8');
const surveys = fs.readFileSync('src/lib/surveys.ts', 'utf8');

describe('one push a day', () => {
  it('the weekly pack poll is not made any more', () => {
    expect(tick).not.toMatch(/recurring_survey_templates/);
    expect(tick).not.toMatch(/createAndSendSurvey/);
    expect(tick).toMatch(/trainingDayBeforeCopy\(locale, \{ day: teamDay \}\)/);
  });
  it('Stage 1 carries the polls waiting to join it, claimed before it sends', () => {
    expect(tick).toMatch(/const joined = await claimJoinedPolls\(supabase, now\)/);
    expect(tick.indexOf('claimJoinedPolls(supabase, now)')).toBeLessThan(tick.indexOf('const { sent, byAthlete } = await sendPushLocalized(subs, (locale) => ({\n          ...build(locale), url, tag,'));
  });
  it('a joined poll waits an hour past the push before it goes alone', () => {
    expect(surveys).toMatch(/next_run_at: new Date\(Date\.parse\(opts\.joinAt!\) \+ JOIN_FALLBACK_MS\)/);
    expect(surveys).toMatch(/if \(opts\.push === false\)/);
  });
});
