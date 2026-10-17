import { createServerClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { COACH_ID } from '@/lib/constants';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';
import { localesForAthletes, persistNotifications, sendPushLocalized, subscriptionsForAthletes } from '@/lib/push';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { DAY_SESSION_FOR_ALL } from './flag';
import { fromRow, isolateNumbers, type DaySession } from './model';

// The day session's reads and writes (migration 149). Every function answers
// `{ setup: false }` rather than throwing while the table has not been pasted, so the form
// can say so and the feed stays quiet.

type Db = ReturnType<typeof createServerClient>;
const COLS = 'id, session_date, start_time, place, title, quick_text, steps, pack_paces, nutrition, published_at, notify, notified_at, created_by, updated_by, updated_at';

async function withNames(db: Db, rows: Record<string, unknown>[]): Promise<DaySession[]> {
  const ids = [...new Set(rows.map((r) => (r.updated_by || r.created_by) as string | null).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from('athletes').select('id, name').in('id', ids);
    for (const a of (data || []) as Array<{ id: string; name: string | null }>) names.set(a.id, a.name || '');
  }
  return rows.map((r) => ({ ...fromRow(r), byName: names.get(((r.updated_by || r.created_by) as string) || '') || null }));
}

/** The date's row, published or not — the form. */
export async function readDaySession(date: string): Promise<{ setup: boolean; session: DaySession | null }> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').select(COLS).eq('session_date', date).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { setup: false, session: null };
    throw error;
  }
  if (!data) return { setup: true, session: null };
  return { setup: true, session: (await withNames(db, [data]))[0] };
}

/** Today's and tomorrow's published rows — the feed (isOnFeed decides the hour). */
export async function readUpcoming(now: Date = new Date()): Promise<{ setup: boolean; sessions: DaySession[] }> {
  const today = israelToday(now);
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').select(COLS)
    .gte('session_date', today)
    .lte('session_date', addDaysToDateStr(today, 1))
    .not('published_at', 'is', null)
    .order('session_date', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { setup: false, sessions: [] };
    throw error;
  }
  return { setup: true, sessions: await withNames(db, (data || []) as Record<string, unknown>[]) };
}

/** Insert or update the date's row. `null` = the table is not there yet. */
export async function saveDaySession(row: Record<string, unknown>): Promise<DaySession | null> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'session_date' })
    .select(COLS)
    .single();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return fromRow(data as Record<string, unknown>);
}

/** The push's claim: true only for the one call that set notified_at. */
export async function claimNotify(id: string): Promise<boolean> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', id)
    .is('notified_at', null)
    .not('published_at', 'is', null)
    .select('id');
  if (error) return false;
  return (data || []).length > 0;
}

/**
 * Who hears about it. Flag off: the super user who published it, nobody else — the card is
 * his alone, so a push to the club would point everybody at a card they cannot see. Flag
 * on: every active member of the club (not the club's own account).
 */
export async function daySessionRecipients(callerAthleteId: string | null, forAll = DAY_SESSION_FOR_ALL): Promise<string[]> {
  if (!forAll) return callerAthleteId ? [callerAthleteId] : [];
  const db = createServerClient();
  const { data } = await db.from('athletes').select('id')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active')
    .or(`role.is.null,role.neq.${CLUB_ACCOUNT_ROLE}`);
  return ((data || []) as Array<{ id: string }>).map((a) => a.id);
}

const WHEN: Record<NotificationLocale, { today: string; tomorrow: string; food: string }> = {
  he: { today: 'היום', tomorrow: 'מחר', food: 'ותזונה לאימון' },
  en: { today: 'Today', tomorrow: 'Tomorrow', food: 'and the session nutrition' },
};

/** "מחר: 6 × 1 ק״מ" / "19:00 · פארק הירקון · ותזונה לאימון". */
export function daySessionCopy(locale: NotificationLocale, s: Pick<DaySession, 'date' | 'title' | 'startTime' | 'place' | 'nutrition'>, today: string): { title: string; body: string } {
  const w = WHEN[locale] ?? WHEN.he;
  const when = s.date === today ? w.today : w.tomorrow;
  // "6 × 1" in its own LTR run inside the Hebrew line (isolateNumbers).
  const title = `${when}: ${isolateNumbers(s.title)}`;
  const body = [s.startTime, s.place, s.nutrition.length ? w.food : null].filter(Boolean).join(' · ');
  return { title, body };
}

/** The push + the inbox row, through the club's usual fan-out. Returns devices reached. */
export async function sendDaySessionPush(s: DaySession, recipients: string[], now: Date = new Date()): Promise<number> {
  if (!recipients.length) return 0;
  const today = israelToday(now);
  const url = '/feed';
  const subs = await subscriptionsForAthletes(recipients);
  let sent = 0;
  let byAthlete: Record<string, number> = {};
  if (subs.length) {
    const r = await sendPushLocalized(subs, (locale) => ({
      ...daySessionCopy(locale, s, today),
      url,
      tag: `day-session:${s.date}`,
      category: 'program',
    }));
    sent = r.sent;
    byAthlete = r.byAthlete;
  }
  const locales = await localesForAthletes(recipients);
  await persistNotifications(
    recipients.map((athleteId) => ({
      athleteId,
      kind: 'day_session',
      ...daySessionCopy(locales.get(athleteId) ?? DEFAULT_NOTIFICATION_LOCALE, s, today),
      url,
    })),
    byAthlete,
  );
  return sent;
}
