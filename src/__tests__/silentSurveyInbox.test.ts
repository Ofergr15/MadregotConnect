import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * #130 (2026-10-19): the day-before push asks "coming, with which pack?" and opens
 * the RSVP card; the morning poll is created without its own push. Its row must not
 * be 'sent', because the inbox lists every 'sent' row — that was a second
 * notification, leading to a different screen, for the same question.
 */
describe('a poll created without a push', () => {
  const src = readFileSync('src/lib/surveys.ts', 'utf8');
  it('is inserted silent, never scheduled — the every-minute sender sends any due scheduled row', () => {
    expect(src).toMatch(/status: opts\.push === false \? 'silent' : 'scheduled'/);
    expect(readFileSync('src/app/api/cron/notifications/route.ts', 'utf8')).toMatch(/\.eq\('status', 'scheduled'\)/);
  });

  it('is still a poll the inbox would skip: the inbox reads only sent rows', () => {
    expect(readFileSync('src/app/api/notifications/inbox/route.ts', 'utf8')).toMatch(/\.eq\('status', 'sent'\)/);
  });
});
