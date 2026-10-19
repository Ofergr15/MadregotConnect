import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { nextBirthday } from '@/lib/events/upcoming';
import { isExcluded, readPrExclusions } from '@/lib/prs/exclusions-store';
import { addDaysIso, computeYearStats, daysBetweenIso, momentOf, yearWindow, type YearActivityRow, type YearStats } from './stats';

/**
 * The birthday story's server side: which birthday a story is for, the year's rows, and
 * what the admin prepared for it (photos, a personal word, the official race time).
 *
 * The preparation lives in `app_settings`, one JSON value per person per birthday
 * (`birthday_year:<athleteId>:<YYYY-MM-DD>`), and the photos in the public `feed-media`
 * bucket — so the feature needs no migration.
 *
 * WHO GETS IT is no longer decided here (stories phase 2): every path goes through
 * storyGate('birthday') + the per-person overrides (lib/stories/access.ts, runners.ts).
 * `birthday_year_send` is read only as a LEGACY value for the admin screen: it can no
 * longer open anything. A per-story `published:false` still CLOSES that one story;
 * `published:true` no longer bypasses the gate.
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

/**
 * The legacy per-story switch, narrowed: `published:false` closes this one story;
 * `true` / unset change nothing (the gate decides). It can only close, never open.
 */
export function legacyClosed(cfg: BirthdayConfig): boolean {
  return cfg.published === false;
}

type Db = SupabaseClient;
const key = (athleteId: string, birthday: string) => `birthday_year:${athleteId}:${birthday}`;

/**
 * The birthday a story celebrates on `today`: the one that just happened (up to OPEN_DAYS
 * ago) for its owner; for the admin's preview, else the next one.
 */
export function storyBirthday(birthDate: string, today: string, opts: { preview?: boolean; lookbackDays?: number } = {}): string | null {
  const recent = nextBirthday(birthDate, addDaysIso(today, -(opts.lookbackDays ?? OPEN_DAYS)));
  if (recent && daysBetweenIso(recent, today) >= 0) return recent;
  return opts.preview ? nextBirthday(birthDate, today) : null;
}

/** LEGACY: the old club-wide switch, shown on the admin screen only. Opens nothing. */
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
      // No routes here: a year of them is ~2 MB and two seconds, and one is drawn (attachMoment).
      .select('id, activity_type, activity_name, start_time, distance, duration, elevation_gain, calories')
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

/**
 * The year's numbers, kept for ten minutes per instance: the strip of birthday circles asks
 * for the same story from every member who opens the feed, and the year does not change in
 * between. The admin's preparation (photos, the official time) is read fresh every time.
 */
const CACHE_MS = 10 * 60_000;
const yearCache = new Map<string, { at: number; stats: Promise<YearStats> }>();

function yearStats(supabase: Db, athleteId: string, window: { from: string; to: string }): Promise<YearStats> {
  const k = `${athleteId}:${window.to}`;
  const hit = yearCache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats;
  const stats = (async () => {
    const [rows, excluded] = await Promise.all([
      loadRows(supabase, athleteId, window.from, window.to),
      readPrExclusions(supabase as never, athleteId).catch(() => undefined),
    ]);
    const s = computeYearStats(rows, window);
    // A run the athlete took out of their records stays out of the year's bests too.
    if (excluded) s.bests = s.bests.filter((b) => !isExcluded(excluded, b.activityId, b.key));
    await attachMoment(supabase, s, rows);
    return s;
  })();
  yearCache.set(k, { at: Date.now(), stats });
  stats.catch(() => yearCache.delete(k));
  return stats;
}

/** The run of the year: the marathon, else the half, whose route is stored — one row's route. */
async function attachMoment(supabase: Db, s: YearStats, rows: YearActivityRow[]): Promise<void> {
  for (const key of ['fm', 'hm'] as const) {
    const id = s.bests.find((b) => b.key === key)?.activityId;
    const act = id ? rows.find((r) => r.id === id) : null;
    if (!act) continue;
    const { data } = await supabase.from('athlete_activities').select('route_preview_hd, route_preview').eq('id', act.id).maybeSingle();
    const r = data as { route_preview_hd?: Array<{ lat: number; lng: number }> | null; route_preview?: Array<{ lat: number; lng: number }> | null } | null;
    const route = r?.route_preview_hd?.length ? r.route_preview_hd : r?.route_preview ?? [];
    if (route.length > 2) {
      s.moment = momentOf(act, key, route);
      return;
    }
  }
}

export interface BirthdayStory {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  birthday: string;
  /** 'male' | 'female' | null — the story's verbs when somebody else is watching it. */
  gender?: string | null;
  stats: YearStats;
  config: BirthdayConfig;
}

export async function loadStory(supabase: Db, athleteId: string, today: string, opts: { preview?: boolean; lookbackDays?: number } = {}): Promise<BirthdayStory | null> {
  const { data: a } = await supabase.from('athletes').select('id, name, avatar_url, birth_date, gender')
    .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
  const athlete = a as { id: string; name: string | null; avatar_url: string | null; birth_date: string | null; gender?: string | null } | null;
  if (!athlete?.birth_date) return null;
  const birthday = storyBirthday(athlete.birth_date, today, opts);
  if (!birthday) return null;
  // A preview before the birthday stops at yesterday: days still to come are not rest days.
  const full = yearWindow(birthday);
  const window = { from: full.from, to: full.to < today ? full.to : addDaysIso(today, -1) };
  const [stats, config] = await Promise.all([
    yearStats(supabase, athleteId, window),
    readConfig(supabase, athleteId, birthday),
  ]);
  if (stats.moment && config.momentSeconds) stats.moment = { ...stats.moment, seconds: config.momentSeconds };
  return {
    athleteId,
    name: config.displayName?.trim() || (athlete.name || '').trim().split(/\s+/)[0] || '',
    avatarUrl: athlete.avatar_url,
    birthday,
    gender: athlete.gender ?? null,
    stats,
    config,
  };
}

/**
 * The annual story's content: the same generator over the calendar year (Jan 1 – Dec 31
 * of `year`), stopping at yesterday while the year is not over. `birthday` carries the
 * period date (Dec 31) so the client renders it like a birthday story for now; the
 * annual's own slides are phase 3.
 */
export async function loadAnnualStory(supabase: Db, athleteId: string, year: number, today: string): Promise<BirthdayStory | null> {
  const { data: a } = await supabase.from('athletes').select('id, name, avatar_url, gender')
    .eq('id', athleteId).eq('coach_id', COACH_ID).maybeSingle();
  const athlete = a as { id: string; name: string | null; avatar_url: string | null; gender?: string | null } | null;
  if (!athlete) return null;
  const period = `${year}-12-31`;
  const from = `${year}-01-01`;
  const to = period <= today ? period : addDaysIso(today, -1);
  if (to < from) return null;
  const stats = await yearStats(supabase, athleteId, { from, to });
  return {
    athleteId,
    name: (athlete.name || '').trim().split(/\s+/)[0] || '',
    avatarUrl: athlete.avatar_url,
    birthday: period,
    gender: athlete.gender ?? null,
    stats,
    config: {},
  };
}
