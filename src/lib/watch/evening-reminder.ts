import type { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';
import { notifyAthlete } from '@/lib/push';
import { addDaysToDateStr, getPlanWeekStart, israelToday } from '@/lib/utils';
import type { NotificationLocale } from '@/lib/notifications/locale';
import { appleCandidates } from './index';
import { missingForAthletes, type MissingReason } from './missing';

// The one evening reminder (mockup watch-send-next, A2): at 20:00 — the hour tomorrow's
// session card appears on the feed — every runner whose session for TOMORROW was sent to
// their watch and is not on it, for a reason they can fix (Garmin disconnected / the link
// expired), gets one push. One per runner per night, however many sessions are missing.
// It replaces the immediate "your watch is disconnected" push the planner and the one-day
// send used to fire on every failed delivery. The tick (api/cron/tick) owns the once-a-night
// ledger; this only decides who and sends.

export const EVENING_KIND = 'watch_evening';

export function eveningCopy(locale: NotificationLocale, reason: MissingReason): { title: string; body: string } {
  if (locale === 'en') {
    return {
      title: "Tomorrow's session isn't on your watch yet",
      body: reason === 'disconnected'
        ? 'Garmin is not connected. Tap to connect, and the session goes to your watch by itself.'
        : 'Your Garmin link expired. Tap to reconnect, and the session goes to your watch by itself.',
    };
  }
  return {
    title: 'האימון של מחר עוד לא בשעון שלך',
    body: reason === 'disconnected'
      ? 'גרמין לא מחובר. נגיעה כדי להתחבר, והאימון יגיע לשעון לבד.'
      : 'החיבור לגרמין פג. נגיעה כדי להתחבר, והאימון יגיע לשעון לבד.',
  };
}

export async function sendEveningWatchReminders(
  supabase: ReturnType<typeof createServerClient>,
  now: Date = new Date(),
): Promise<number> {
  const tomorrow = addDaysToDateStr(israelToday(now), 1);
  const weekStart = getPlanWeekStart(new Date(`${tomorrow}T12:00:00`));
  const { data } = await supabase.from('athletes').select('id, name, garmin_auth')
    .eq('coach_id', COACH_ID).eq('status', 'active')
    .or(`role.is.null,role.neq.${CLUB_ACCOUNT_ROLE}`);
  const athletes = (data || []) as Array<{ id: string; name: string; garmin_auth?: unknown }>;
  // Apple has its own queue on the phone; only Garmin runners are judged here.
  const apple = await appleCandidates(supabase, athletes as never);
  const garminSide = athletes.filter((a) => !apple.has(a.id));
  // "Tomorrow" is judged as of tomorrow: a session already run today is not missing.
  const missing = await missingForAthletes(garminSide, weekStart, tomorrow, supabase);
  let sent = 0;
  for (const a of garminSide) {
    const m = missing.get(a.id);
    if (!m || !m.fixable || !m.reason || !m.missing.includes(tomorrow)) continue;
    try {
      const reason = m.reason;
      await notifyAthlete({
        athleteId: a.id,
        kind: EVENING_KIND,
        copy: (locale) => eveningCopy(locale, reason),
        url: '/dashboard/profile?tab=datasource',
        tag: `${EVENING_KIND}-${a.id}-${tomorrow}`,
        category: 'workouts',
      });
      sent++;
    } catch {
      // one runner's push never stops the others
    }
  }
  return sent;
}
