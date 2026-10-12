import { describe, expect, it } from 'vitest';
import fs from 'fs';

// Ofer, 2026-10-12: the day-before reminder and the pack poll went out as two
// pushes in the same minute. One push now asks both.
const tick = fs.readFileSync('src/app/api/cron/tick/route.ts', 'utf8');
const surveys = fs.readFileSync('src/lib/surveys.ts', 'utf8');

describe('one day-before push', () => {
  it('Stage 1 asks the pack when the day has a poll', () => {
    expect(tick).toMatch(/trainingDayBeforeCopy\(locale, \{ day: teamDay, askPack: !!surveyTpl \}\)/);
  });
  it('the poll is created without its own push', () => {
    expect(tick).toMatch(/createdBy: 'cron',[\s\S]{0,400}push: false/);
    expect(surveys).toMatch(/if \(opts\.push === false\)/);
  });
  it('the evening pack nudge skips whoever Stage 2 just asked', () => {
    expect(tick).toMatch(/answeredElsewhere: \[\.\.\.answeredByRsvp, \.\.\.askedByStage2\]/);
  });
});
