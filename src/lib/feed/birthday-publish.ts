import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { nextBirthday } from '@/lib/events/upcoming';
import { BIRTHDAY_DAYS_KEY, readBirthdayDays, untilAfter } from '@/lib/feed/celebration-days';
import { birthdayBody, birthdayPostAllowed } from '@/lib/feed/birthday';
import { readStorySettings, storyGateMany } from '@/lib/stories/gate';
import { readInstances, type StoryInstance } from '@/lib/stories/instances';

// Server-only half of lib/feed/birthday.ts (that one is bundled for the client too):
// the 06:00 public birthday post, behind THE STORIES GATE (birthdayPostAllowed).

/** Today's posts, once each. Never throws — a missed card must not fail the tick. Returns how many were posted. */
export async function publishBirthdayPosts(supabase: SupabaseClient, today: string, now: Date = new Date()): Promise<number> {
  try {
    // Closed unless the birthday feature AND its public-post switch are on (fails closed).
    const settings = await readStorySettings('birthday', { db: supabase as never });
    if (!birthdayPostAllowed(settings, true, null, null)) return 0;
    const { data: daysRow } = await supabase.from('app_settings').select('value').eq('key', BIRTHDAY_DAYS_KEY).maybeSingle();
    const birthdayDays = readBirthdayDays((daysRow as { value?: string } | null)?.value);
    const { data } = await supabase.from('athletes').select('id, name, birth_date')
      .eq('coach_id', COACH_ID).eq('status', 'active').not('birth_date', 'is', null);
    const born = ((data || []) as Array<{ id: string; name: string | null; birth_date: string }>)
      .filter((a) => a.name && nextBirthday(a.birth_date, today) === today);
    if (born.length === 0) return 0;
    const gated = await storyGateMany('birthday', born.map((a) => a.id), { db: supabase as never, forPush: false });
    const prefs = new Map<string, unknown>();
    {
      const { data: p, error } = await supabase.from('athletes').select('id, story_prefs').in('id', born.map((a) => a.id));
      if (!error) for (const r of (p || []) as { id: string; story_prefs: unknown }[]) prefs.set(r.id, r.story_prefs);
    }
    const { map } = await readInstances(supabase, 'birthday', [today]).catch(() => ({ map: new Map<string, StoryInstance>() }));
    let n = 0;
    for (const a of born) {
      if (!birthdayPostAllowed(settings, gated.has(a.id), prefs.get(a.id), map.get(`${a.id}:${today}`) ?? null)) continue;
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
