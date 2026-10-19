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
  const silent = src.slice(src.indexOf('if (opts.push === false)'), src.indexOf('return { survey, sent: 0 };'));

  it('is marked silent, not sent', () => {
    expect(silent).toMatch(/status: 'silent'/);
    expect(silent).not.toMatch(/status: 'sent'/);
  });

  it('is still a poll the inbox would skip: the inbox reads only sent rows', () => {
    expect(readFileSync('src/app/api/notifications/inbox/route.ts', 'utf8')).toMatch(/\.eq\('status', 'sent'\)/);
  });
});
