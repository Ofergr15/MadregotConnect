import { BIRTHDAY_DAYS_KEY, readBirthdayDays, untilAfter } from '@/lib/feed/celebration-days';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { nextBirthday } from '@/lib/events/upcoming';
import { mentionToken } from '@/lib/feed/mentions';

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

/** Today's posts, once each. Never throws — a missed card must not fail the tick. Returns how many were posted. */
export async function publishBirthdayPosts(supabase: SupabaseClient, today: string, now: Date = new Date()): Promise<number> {
  try {
    const { data: daysRow } = await supabase.from('app_settings').select('value').eq('key', BIRTHDAY_DAYS_KEY).maybeSingle();
    const birthdayDays = readBirthdayDays((daysRow as { value?: string } | null)?.value);
    const { data } = await supabase.from('athletes').select('id, name, birth_date')
      .eq('coach_id', COACH_ID).eq('status', 'active').not('birth_date', 'is', null);
    const born = ((data || []) as Array<{ id: string; name: string | null; birth_date: string }>)
      .filter((a) => a.name && nextBirthday(a.birth_date, today) === today);
    let n = 0;
    for (const a of born) {
      const { data: existing } = await supabase.from('feed_items').select('id')
        .eq('type', 'announcement').eq('payload->>birthdayOf', a.id).eq('payload->>date', today).maybeSingle();
      if (existing) continue;
      const { error } = await supabase.from('feed_items').insert({
        type: 'announcement',
        author_athlete_id: null,
        body: birthdayBody(a.name!, a.id),
        payload: { birthdayOf: a.id, honoreeId: a.id, date: today, until: untilAfter(today, birthdayDays) },
        occurred_at: now.toISOString(),
      });
      if (error) console.warn(`publishBirthdayPosts ${a.id} failed:`, error.message);
      else n++;
    }
    return n;
  } catch (err) {
    console.warn('publishBirthdayPosts failed:', err);
    return 0;
  }
}
