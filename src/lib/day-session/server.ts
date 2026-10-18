import { createServerClient } from '@/lib/supabase/server';
import { isMissingColumn, isMissingTable } from '@/lib/supabase/schema-drift';
import { COACH_ID } from '@/lib/constants';
import { CLUB_ACCOUNT_ROLE } from '@/lib/notifications/prefs';
import { localesForAthletes, persistNotifications, sendPushLocalized, subscriptionsForAthletes } from '@/lib/push';
import { DEFAULT_NOTIFICATION_LOCALE, type NotificationLocale } from '@/lib/notifications/locale';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { DAY_SESSION_FOR_ALL } from './flag';
import { defaultPushCopy, fromRow, type DaySession } from './model';

// The day session's reads and writes (migration 150). Every function answers
// `{ setup: false }` rather than throwing while the table has not been pasted, so the form
// can say so and the feed stays quiet.

type Db = ReturnType<typeof createServerClient>;
const COLS = 'id, session_date, start_time, place, title, quick_text, steps, pack_paces, nutrition, published_at, notify, notified_at, created_by, updated_by, updated_at';
// Columns added after migration 150: "הערות לאימון" (151) and "אימון איכות" (153). Until
// one is pasted every read and write retries without it, so the form and the feed work and
// that field is simply not kept.
const OPTIONAL = ['description', 'quality'] as const;
const colsWithout = (skip: ReadonlySet<string>) => [COLS, ...OPTIONAL.filter((c) => !skip.has(c))].join(', ');
const missingOf = (error: unknown) => OPTIONAL.find((c) => isMissingColumn(error, c)) ?? null;

/** Runs `go` with the optional columns, dropping each one the table says it lacks. */
async function withOptional<T extends { error: unknown }>(go: (cols: string, skip: ReadonlySet<string>) => PromiseLike<T>): Promise<T> {
  const skip = new Set<string>();
  for (;;) {
    const res = await go(colsWithout(skip), skip);
    const missing = res.error ? missingOf(res.error) : null;
    if (!missing || skip.has(missing)) return res;
    skip.add(missing);
  }
}

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
  const { data, error } = await withOptional((cols) => db.from('day_sessions').select(cols).eq('session_date', date).maybeSingle());
  if (error) {
    if (isMissingTable(error)) return { setup: false, session: null };
    throw error;
  }
  if (!data) return { setup: true, session: null };
  return { setup: true, session: (await withNames(db, [data as unknown as Record<string, unknown>]))[0] };
}

/** Today's and tomorrow's published rows — the feed (isOnFeed decides the hour). */
export async function readUpcoming(now: Date = new Date()): Promise<{ setup: boolean; sessions: DaySession[] }> {
  const today = israelToday(now);
  const db = createServerClient();
  const { data, error } = await withOptional((cols) => db.from('day_sessions').select(cols)
    .gte('session_date', today)
    .lte('session_date', addDaysToDateStr(today, 1))
    .not('published_at', 'is', null)
    .order('session_date', { ascending: true }));
  if (error) {
    if (isMissingTable(error)) return { setup: false, sessions: [] };
    throw error;
  }
  return { setup: true, sessions: await withNames(db, (data || []) as unknown as Record<string, unknown>[]) };
}

/** Every row from today on, published or not — the coach's list (mockups/day-session-manage). */
export async function readFromToday(now: Date = new Date()): Promise<{ setup: boolean; sessions: DaySession[] }> {
  const db = createServerClient();
  const { data, error } = await withOptional((cols) => db.from('day_sessions').select(cols)
    .gte('session_date', israelToday(now))
    .order('session_date', { ascending: true })
    .limit(30));
  if (error) {
    if (isMissingTable(error)) return { setup: false, sessions: [] };
    throw error;
  }
  return { setup: true, sessions: await withNames(db, (data || []) as unknown as Record<string, unknown>[]) };
}

/** Insert or update the date's row. `null` = the table is not there yet. */
export async function saveDaySession(row: Record<string, unknown>): Promise<DaySession | null> {
  const db = createServerClient();
  const { data, error } = await withOptional((cols, skip) => {
    const r = Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
    return db.from('day_sessions')
      .upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'session_date' })
      .select(cols)
      .single();
  });
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return fromRow(data as unknown as Record<string, unknown>);
}

/**
 * Delete the date's row (Ofer, 2026-10-18: a session published for the wrong day). Gone from
 * the feed and the form at once; the push already sent cannot be taken back. `false` = there
 * was no row, `null` = the table is not there yet.
 */
export async function deleteDaySession(date: string): Promise<boolean | null> {
  const db = createServerClient();
  const { data, error } = await db.from('day_sessions').delete().eq('session_date', date).select('id');
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data || []).length > 0;
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

/** The coach's text when he wrote one, else the default (lib/day-session/model.ts). */
export function daySessionCopy(
  locale: NotificationLocale,
  s: Pick<DaySession, 'date' | 'steps' | 'startTime' | 'place' | 'nutrition'>,
  today: string,
  own?: { title: string | null; body: string | null },
): { title: string; body: string } {
  const d = defaultPushCopy(s, today, locale === 'en' ? 'en' : 'he');
  return { title: own?.title || d.title, body: own?.body || d.body };
}

/** The push + the inbox row, through the club's usual fan-out. Returns devices reached. */
export async function sendDaySessionPush(s: DaySession, recipients: string[], now: Date = new Date(), own?: { title: string | null; body: string | null }): Promise<number> {
  if (!recipients.length) return 0;
  const today = israelToday(now);
  const url = '/feed';
  const subs = await subscriptionsForAthletes(recipients);
  let sent = 0;
  let byAthlete: Record<string, number> = {};
  if (subs.length) {
    const r = await sendPushLocalized(subs, (locale) => ({
      ...daySessionCopy(locale, s, today, own),
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
      ...daySessionCopy(locales.get(athleteId) ?? DEFAULT_NOTIFICATION_LOCALE, s, today, own),
      url,
    })),
    byAthlete,
  );
  return sent;
}
