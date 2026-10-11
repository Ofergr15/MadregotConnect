// "לבקש מכולם למלא בעצמם" (mockup academy-existing-trainees, phone 1): one request to every
// trainee the list says has no usable test, so they can send their last test from the card on
// their home (phone 4). Pure; POST /api/academy/completion/request sends.
//
// ONCE, which is the mockup's word and the reason this is a function: the coach will tap the
// button again next week to be sure, and a trainee asked twice for the same thing has been
// nagged, not reminded. The `scheduled_notifications` row `notifyAthlete` already writes is
// the record — no new table — and a trainee counts as already asked while that row is newer
// than their newest test. A test that arrives and goes stale again (four months later) makes
// them askable again, which is the one case a second request is news.

import type { NotificationLocale } from '@/lib/notifications/locale';
import type { CompletionRow } from './completion';

export const TEST_REQUEST_KIND = 'academy_test_request';

/** Who is asked: no test, a 2000 m only, or a test too old to price a plan. Not "waiting for approval". */
export const askable = (row: Pick<CompletionRow, 'test'>) =>
  row.test === 'none' || row.test === 'otherProtocol' || row.test === 'old';

export interface PriorRequest {
  athleteId: string;
  /** When the earlier request went out (`last_sent_at` or `created_at`). */
  sentAt: string;
}

export interface RequestPlan {
  ask: string[];
  /** Already asked since their last test: skipped. */
  already: string[];
}

export function whoToAsk(
  rows: Array<Pick<CompletionRow, 'athleteId' | 'test' | 'testDate'>>,
  prior: PriorRequest[],
): RequestPlan {
  const lastAsked = new Map<string, string>();
  for (const p of prior) {
    const at = String(p.sentAt || '');
    if (at > (lastAsked.get(p.athleteId) ?? '')) lastAsked.set(p.athleteId, at);
  }
  const ask: string[] = [];
  const already: string[] = [];
  for (const row of rows) {
    if (!askable(row)) continue;
    const asked = lastAsked.get(row.athleteId);
    // A request made after their newest test (or ever, when they never had one) still stands.
    const stands = !!asked && (!row.testDate || asked.slice(0, 10) >= row.testDate);
    (stands ? already : ask).push(row.athleteId);
  }
  return { ask, already };
}

/** The request's words, per language. The coach's first name when there is one. */
export function testRequestCopy(
  locale: NotificationLocale,
  p: { coach?: string | null; coachGender?: string | null },
): { title: string; body: string } {
  const coach = (p.coach || '').trim().split(/\s+/)[0] || '';
  // Hebrew verbs agree with the coach; gender is null on most rows, hence the neutral fallback.
  const asks = p.coachGender === 'female' ? 'מבקשת' : p.coachGender === 'male' ? 'מבקש' : 'מבקש/ת';
  return locale === 'he'
    ? {
        title: '🎯 חסר לנו הטסט האחרון שלך',
        body: `${coach ? `${coach} ${asks}: ` : ''}אפשר למצוא אותו בשעון או להקליד. ממנו נחשב לך קצבים אישיים לכל אימון.`,
      }
    : {
        title: '🎯 We are missing your latest test',
        body: `${coach ? `${coach} asks: ` : ''}find it in your watch or type it in. Your personal paces for every workout come from it.`,
      };
}
