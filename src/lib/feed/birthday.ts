import { mentionToken } from '@/lib/feed/mentions';
import type { StorySettingsRow } from '@/lib/stories/gate';
import { optedOut, parseStoryPrefs } from '@/lib/stories/prefs';
import type { StoryInstance } from '@/lib/stories/instances';

/**
 * THE STORIES GATE for the public post (phase 2). Pure: who of today's birthday people
 * get a post. Needs the birthday feature open to them (not 'off'/'self', gate passed),
 * its `feed_post` switch on, and nothing narrowing it for them: their own opt-out of the
 * public post, or an override (feed_post=false, skipped, enabled=false).
 */
export function birthdayPostAllowed(
  settings: StorySettingsRow | null, gated: boolean, prefs: unknown, inst: Partial<StoryInstance> | null,
): boolean {
  if (!settings || !settings.feed_post || settings.state === 'off' || settings.state === 'self') return false;
  if (!gated) return false;
  if (optedOut(parseStoryPrefs(prefs), 'birthday_feed_post')) return false;
  if (inst?.feed_post === false || inst?.skipped || inst?.enabled === false) return false;
  return true;
}

// A birthday is a club post on the feed (Ofer, 2026-10-18: "just write something, and let
// people like or comment — nothing beyond that"). Every morning, one announcement per member
// whose birthday it is: "🎂 היום יום ההולדת של @Shalev! מזל טוב 🎉", from the club, with the
// person tagged. Likes and comments are the feed's own; they reach the birthday person
// (lib/feed/notify.ts, `payload.honoreeId`), the same way they reach a post's author.
// Only members with a birth date on their profile; the year is never shown.

export function birthdayBody(name: string, athleteId: string): string {
  return `🎂 היום יום ההולדת של ${mentionToken(name, athleteId)}! מזל טוב 🎉`;
}

const WEEKDAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * The post's words as of `today`. It is written once, on the day ("היום יום ההולדת של…"),
 * but it can stay on the circles for days (lib/feed/celebration-days.ts): the day after it
 * says "אתמול", later "ביום שלישי" (Ofer, 10-19: Shalev's birthday still read "today" the
 * day after). Anything not in the automatic wording is left as written.
 */
export function birthdayBodyAsOf(body: string | null, date: unknown, today: string): string | null {
  if (!body || typeof date !== 'string' || date >= today) return body;
  const m = body.match(/^🎂 היום יום ההולדת של (.+)! מזל טוב 🎉$/);
  if (!m) return body;
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000);
  const when = days === 1 ? 'אתמול' : `ביום ${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}`;
  return `🎂 ${when} היה יום ההולדת של ${m[1]}! מזל טוב 🎉`;
}

