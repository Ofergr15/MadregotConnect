import { describe, it, expect } from 'vitest';
import { shouldNotifyReporter } from '@/lib/feedback-resolution';
import { reviewResolvedCopy } from '@/lib/notifications/copy';

/**
 * Marking a report "done" pushes a notification to whoever filed it.
 *
 * The whole risk of this feature is over-notifying: triaging one report means
 * several PATCHes of the same row (status, then priority, then a typo fix in the
 * admin note), and a naive "is it done? then notify" check turns one fixed bug
 * into four buzzes on the reporter's phone. So the transition cases below are the
 * real subject of this file, not the happy path.
 */
describe('shouldNotifyReporter', () => {
  it('notifies on the transition into done', () => {
    expect(shouldNotifyReporter('new', 'done', 'a1')).toBe(true);
    expect(shouldNotifyReporter('sprint', 'done', 'a1')).toBe(true);
    expect(shouldNotifyReporter('denied', 'done', 'a1')).toBe(true);
  });

  it('stays silent when the row was already done', () => {
    // The re-save case: same status, some other field changed.
    expect(shouldNotifyReporter('done', 'done', 'a1')).toBe(false);
  });

  it('treats a legacy null status as new, so those still notify', () => {
    expect(shouldNotifyReporter(null, 'done', 'a1')).toBe(true);
    expect(shouldNotifyReporter(undefined, 'done', 'a1')).toBe(true);
  });

  it('stays silent for every status other than done', () => {
    for (const next of ['new', 'idea', 'sprint', 'denied', null, undefined] as const) {
      expect(shouldNotifyReporter('new', next, 'a1')).toBe(false);
    }
  });

  it('stays silent when nobody is attached to the report', () => {
    // Staff-filed and pre-session reports have no athlete_id — there is no one
    // to notify, and `athleteId!` downstream would send garbage.
    expect(shouldNotifyReporter('new', 'done', null)).toBe(false);
    expect(shouldNotifyReporter('new', 'done', undefined)).toBe(false);
    expect(shouldNotifyReporter('new', 'done', '')).toBe(false);
  });
});

describe('reviewResolvedCopy', () => {
  it('quotes the report back so the reporter knows which one this is', () => {
    expect(reviewResolvedCopy('he', { preview: 'הכפתור לא עובד' })).toEqual({
      title: '✅ הדיווח שלך טופל',
      body: 'הכפתור לא עובד',
    });
  });

  it('collapses newlines — a push body is one line whatever was typed', () => {
    expect(reviewResolvedCopy('he', { preview: '  שורה\n\nשנייה  ' }).body).toBe('שורה שנייה');
  });

  it('clips a long report rather than letting the OS truncate mid-word', () => {
    const body = reviewResolvedCopy('en', { preview: 'x'.repeat(200) }).body;
    expect(body).toBe(`${'x'.repeat(80)}…`);
  });

  it('falls back to a thank-you when there is no text to quote', () => {
    expect(reviewResolvedCopy('he', { preview: '   ' }).body).toBe('תודה שדיווחתם — זה תוקן.');
    expect(reviewResolvedCopy('en', { preview: null }).body).toBe('Thanks for reporting it — it’s been fixed.');
  });
});
