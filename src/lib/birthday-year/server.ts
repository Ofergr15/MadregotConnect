import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { nextBirthday } from '@/lib/events/upcoming';
import { isExcluded, readPrExclusions } from '@/lib/prs/exclusions-store';
import { addDaysIso, computeYearStats, daysBetweenIso, yearWindow, type YearActivityRow, type YearStats } from './stats';

/**
 * The birthday story's server side: which birthday a story is for, the year's rows, and
 * what the admin prepared for it (photos, a personal word, the official race time).
 *
 * The preparation lives in `app_settings`, one JSON value per person per birthday
 * (`birthday_year:<athleteId>:<YYYY-MM-DD>`), and the photos in the public `feed-media`
 * bucket — so the feature needs no migration. The on/off switch for sending it to the
 * birthday people themselves is `birthday_year_send` = 'on'; until it is on, only the
 * admin sees stories (to prepare and preview them).
 */

export const SEND_KEY = 'birthday_year_send';
/** How many days after the birthday the story stays open for its owner. */
export const OPEN_DAYS = 7;

export const PHOTO_SLOTS = ['intro', 'thanks', 'km', 'streak', 'moment', 'long', 'climb', 'poster'] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export interface BirthdayConfig {
  /** The name on the story, in Hebrew ("שלו"). The roster name is Latin-only. */
  displayName?: string | null;
  /** A personal word from the club; the thank-you slide shows only when there is one. */
  message?: string | null;
  /** The official time of the run of the year, when it differs from the watch. */
  momentSeconds?: number | null;
  /** Its name on the slide ("מרתון ברלין"); the watch's auto-name is not one. */
  momentTitle?: string | null;
  photos?: Partial<Record<PhotoSlot, string>>;
  /**
   * The admin's own switch for this one story: on = every member sees it (and its owner),
   * off = only the admin, whatever the club-wide switch says. Unset follows the club-wide
   * switch (Ofer, 2026-10-18: "a key to show it to everyone and hide it from everyone").
   */
  published?: boolean | null;
}

/** Whether members (and the owner) may see this story now. */
export function storyVisible(cfg: BirthdayConfig, sending: boolean): boolean {
  return typeof cfg.published === 'boolean' ? cfg.published : sending;
}

type Db = SupabaseClient;
const key = (athleteId: string, birthday: string) => `birthday_year:${athleteId}:${birthday}`;

/**
 * The birthday a story celebrates on `today`: the one that just happened (up to OPEN_DAYS
 * ago) for its owner; for the admin's preview, else the next one.
 */
export function storyBirthday(birthDate: string, today: string, opts: { preview?: boolean } = {}): string | null {
  const recent = nextBirthday(birthDate, addDaysIso(today, -OPEN_DAYS));
  if (recent && daysBetweenIso(recent, today) >= 0) return recent;
  return opts.preview ? nextBirthday(birthDate, today) : null;
}

export async function sendingOn(supabase: Db): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', SEND_KEY).maybeSingle();
  return (data as { value?: string } | null)?.value === 'on';
}

export async function readConfig(supabase: Db, athleteId: string, birthday: string): Promise<BirthdayConfig> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key(athleteId, birthday)).maybeSingle();
  try {
    return JSON.parse((data as { value?: string } | null)?.value || '{}') as BirthdayConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(supabase: Db, athleteId: string, birthday: string, cfg: BirthdayConfig): Promise<boolean> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: key(athleteId, birthday), value: JSON.stringify(cfg), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return !error;
}

/** Every run of the window, paged (a heavy year is ~700 rows). */
async function loadRows(supabase: Db, athleteId: string, from: string, to: string): Promise<YearActivityRow[]> {
  const out: YearActivityRow[] = [];
  for (let page = 0; page < 5; page++) {
    const { data, error } = await supabase.from('athlete_activities')
      .select('id, activity_type, activity_name, start_time, distance, duration, elevation_gain, calories, route_preview_hd, route_preview')
      .eq('athlete_id', athleteId)
      .gte('start_time', `${from}T00:00:00`)
      .lte('start_time', `${to}T23:59:59`)
      .order('start_time', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    const rows = (data || []) as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        ...(r as unknown as YearActivityRow),
        distance: Number(r.distance) || 0,
        duration: Number(r.duration) || 0,
        elevation_gain: r.elevation_gain == null ? null : Number(r.elevation_gain),
        calories: r.calories == null ? null : Number(r.calories),
      });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

export interface BirthdayStory {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  birthday: string;
  stats: YearStats;
  config: BirthdayConfig;
}

export async function loadStory(supabase: Db, athleteId: string, today: string, opts: { preview?: boolean } = {}): Promise<BirthdayStory | null> {
  const { data: a } = await supabase.from('athletes').select('id, name, avatar_url, birth_date')
    .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
  const athlete = a as { id: string; name: string | null; avatar_url: string | null; birth_date: string | null } | null;
  if (!athlete?.birth_date) return null;
  const birthday = storyBirthday(athlete.birth_date, today, opts);
  if (!birthday) return null;
  const window = yearWindow(birthday);
  const [rows, excluded, config] = await Promise.all([
    loadRows(supabase, athleteId, window.from, window.to),
    readPrExclusions(supabase as never, athleteId).catch(() => undefined),
    readConfig(supabase, athleteId, birthday),
  ]);
  // A run the athlete took out of their records stays out of the year's bests too.
  const stats = computeYearStats(rows, window);
  if (excluded) stats.bests = stats.bests.filter((b) => !isExcluded(excluded, b.activityId, b.key));
  if (stats.moment && config.momentSeconds) stats.moment.seconds = config.momentSeconds;
  return {
    athleteId,
    name: config.displayName?.trim() || (athlete.name || '').trim().split(/\s+/)[0] || '',
    avatarUrl: athlete.avatar_url,
    birthday,
    stats,
    config,
  };
}

/**
 * 7:00 on a birthday: "🎂 מזל טוב! הכנו לך את השנה שלך בריצה", opening the story. Only while
 * sending is on, only to members with runs in the year. Returns how many were sent.
 */
export async function sendBirthdayYearPushes(supabase: Db, today: string): Promise<number> {
  const sending = await sendingOn(supabase);
  const { notifyAthlete } = await import('@/lib/push');
  const { birthdayYearCopy } = await import('@/lib/notifications/copy');
  const { data } = await supabase.from('athletes').select('id, birth_date')
    .eq('coach_id', COACH_ID).eq('status', 'active').not('birth_date', 'is', null);
  let sent = 0;
  for (const a of (data || []) as Array<{ id: string; birth_date: string }>) {
    if (nextBirthday(a.birth_date, today) !== today) continue;
    try {
      const story = await loadStory(supabase, a.id, today);
      if (!story || story.stats.runs === 0 || !storyVisible(story.config, sending)) continue;
      await notifyAthlete({
        athleteId: a.id,
        kind: 'birthday_year',
        copy: (locale) => birthdayYearCopy(locale, { name: story.name, km: story.stats.km }),
        url: '/feed?birthdayYear=1',
        tag: `birthday-year-${a.id}-${today}`,
      });
      sent++;
    } catch (err) {
      console.error(`birthday-year push ${a.id} failed:`, err);
    }
  }
  return sent;
}
