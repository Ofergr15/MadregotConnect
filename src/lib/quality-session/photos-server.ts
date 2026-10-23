import type { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { setFolderMeta } from '@/lib/photos/folder-meta';
import type { FolderKind } from '@/lib/photos/folder-kind';
import { folderPhotosNow, signedImageUrl, THUMB } from '@/lib/photos/drive-browse';
import { sessionPhotosStartedCopy } from '@/lib/notifications/copy';
import { addDaysToDateStr, israelNow, israelToday } from '@/lib/utils';
import { COACH_ID, SUPER_USER_EMAIL } from '@/lib/constants';
import { sessionFolderReadyCopy, sessionPhotosCopy } from '@/lib/notifications/copy';
import { driveWriter, ensureDayFolder } from '@/lib/google-drive/writer';
import { loadQualityWorkout } from './server';
import { qualitySessionRecipientIds } from './access';
import { pullAlbumPhotos, pullDrivePhotos, type PulledMedia } from './album-fetch';
import { MAX_SESSION_PHOTOS, SESSION_PHOTOS_KIND, sessionDayLabel, toSessionPhotos, type SessionPhotosPayload } from './photos';

// The quality session's photos, server side (#106). The card itself (publish,
// find) and the automatic folder: Ofer 2026-10-18 — "the days are picked on the
// weekly plan; at 20:00 the evening before, a folder named for the day and its
// date". The days are the plan screen's pick (loadQualityWorkout: the pick when
// there is one, otherwise what the plan says).

type Db = ReturnType<typeof createServerClient>;

/** app_settings: date → that morning's folder, and how far the automation got. */
export const FOLDER_LEDGER_KEY = 'session_photo_folders';
export interface FolderEntry {
  folderId: string;
  link: string;
  /** The folder's name in Drive, as made. */
  name?: string;
  /** Made from the Social screen rather than by the evening-before automation. */
  manual?: boolean;
  /** false: the folder is only a folder — nothing reaches the feed by itself. */
  autoFeed?: boolean;
  createdAt?: string;
  toldAt?: string;
  checkedAt?: string;
  publishedId?: string;
  /**
   * Publish by itself, as before 10-19. Unset (the default since): the morning check only
   * tells the editors, and an editor publishes from the staff card (approveSessionPhotos).
   */
  autoPublish?: boolean;
  /** Photos in the folder at the last check, and the first few of them for the staff card. */
  found?: number;
  previews?: string[];
  /** How many photos the editors were last told about, so each new batch tells them once. */
  notifiedCount?: number;
  /** "לא צריך תיקייה ליום הזה" (תחילת שבוע): the automation leaves this day alone. */
  skipped?: boolean;
  /**
   * When the automation makes the folder, Israel wall clock "YYYY-MM-DDTHH:MM"
   * (folders-plan, Ofer 10-20). Unset: the evening before at 20:00.
   */
  createAt?: string;
  /** What the photos screen files it under, set on the folder when it is made. */
  kind?: FolderKind;
  tags?: string[];
  /** A scheduled folder made by hand: false keeps the editors from being told when it is made. */
  notifyEditors?: boolean;
}
export type FolderLedger = Record<string, FolderEntry>;

export async function readFolderLedger(supabase: Db): Promise<FolderLedger> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', FOLDER_LEDGER_KEY).maybeSingle();
  try {
    const v = JSON.parse((data as { value?: string } | null)?.value || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

async function writeFolderLedger(supabase: Db, ledger: FolderLedger): Promise<void> {
  // Keep two weeks: the ledger is a day-by-day note, not an archive.
  const cutoff = addDaysToDateStr(israelToday(), -14);
  const kept = Object.fromEntries(Object.entries(ledger).filter(([d]) => d >= cutoff));
  await supabase.from('app_settings').upsert({ key: FOLDER_LEDGER_KEY, value: JSON.stringify(kept) }, { onConflict: 'key' });
}

export async function cardFor(supabase: Db, date: string) {
  const { data } = await supabase
    .from('feed_items')
    .select('id, payload, media')
    .eq('type', 'announcement')
    .eq('payload->>kind', SESSION_PHOTOS_KIND)
    .eq('payload->>date', date)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle<{ id: string; payload: Record<string, unknown>; media: PulledMedia[] | null }>();
  return data;
}

/**
 * Who hears that the photos are up: the whole club, once per day's card (Ofer,
 * 2026-10-18 — every quality session and every event, not only who marked
 * "coming"; an event has no RSVP at all, so that rule told nobody).
 */
export async function clubMembers(supabase: Db): Promise<string[]> {
  const { data } = await supabase.from('athletes').select('id').eq('coach_id', COACH_ID).eq('status', 'active');
  return ((data || []) as Array<{ id: string }>).map((r) => r.id);
}

/** Who marked "coming" that morning. Attendance weeks start on Sunday. */
export async function attendees(supabase: Db, date: string): Promise<string[]> {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data } = await supabase.from('workout_attendance').select('athlete_id')
    .eq('week_start_date', addDaysToDateStr(date, -dow)).eq('day_of_week', dow).eq('attending', true);
  return [...new Set(((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id))];
}

/**
 * The day's card: published, or updated in place (one card per day). The club is
 * told on the first publish only, and only with `notify`.
 */
export async function publishSessionPhotos(
  supabase: Db,
  p: { date: string; link: string; media: PulledMedia[]; byAthleteId: string | null; notify: boolean; name?: string | null },
): Promise<{ id: string; updated?: boolean; told: number }> {
  const workoutName = (await loadQualityWorkout(supabase, p.date).catch(() => null))?.name || null;
  const payload: SessionPhotosPayload = {
    kind: SESSION_PHOTOS_KIND, date: p.date, workoutName, link: p.link, byAthleteId: p.byAthleteId,
  };
  const existing = await cardFor(supabase, p.date);
  if (existing) {
    const { error } = await supabase.from('feed_items')
      .update({ payload, media: p.media.length ? p.media : null }).eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, updated: true, told: 0 };
  }
  const { data: created, error } = await supabase.from('feed_items').insert({
    type: 'announcement',
    author_athlete_id: null,
    body: null,
    media: p.media.length ? p.media : null,
    payload,
    // Now, not the session's morning: the card is news when the photos land.
    occurred_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;

  let told = 0;
  if (p.notify) {
    for (const athleteId of (await clubMembers(supabase)).filter((id) => id !== p.byAthleteId)) {
      try {
        await notifyAthlete({
          athleteId,
          kind: 'session_photos',
          actorAthleteId: p.byAthleteId,
          copy: (locale) => sessionPhotosCopy(locale, { workout: workoutName, event: p.name }),
          url: `/feed?item=${created.id}`,
          tag: `session-photos-${p.date}`,
        });
        told += 1;
      } catch { /* one phone must not stop the rest */ }
    }
  }
  return { id: created.id, told };
}

/** "אימון איכות · שלישי 13.10" / "ריצה ארוכה · שישי 23.10" — the folder's name in Drive. */
export function folderName(date: string, kind: FolderKind = 'quality'): string {
  return `${kind === 'long' ? 'ריצה ארוכה' : 'אימון איכות'} · ${sessionDayLabel(date)}`;
}

/** A long-run morning reads as one: the plan marks it `long` (QualityWorkout), or its type is a long run. */
const isLong = (w: { type?: string; long?: true } | null | undefined) => !!w && (w.long === true || w.type === 'long_run');

/** When a day's folder is made: its own time, else the evening before at FOLDER_AT_HOUR. */
export function createTimeOf(date: string, e?: Pick<FolderEntry, 'createAt'> | null): string {
  return e?.createAt || `${addDaysToDateStr(date, -1)}T${String(FOLDER_AT_HOUR).padStart(2, '0')}:00`;
}

/** Tags a proposal starts with, from the workout's or race's name: "טסט" in it is #טסט. */
export function suggestedTags(text: string): string[] {
  const out: string[] = [];
  if (/טסט/.test(text)) out.push('טסט');
  if (/חצי\s*מרתון|half/i.test(text)) out.push('חצי מרתון');
  else if (/מרתון|marathon/i.test(text)) out.push('מרתון');
  return out;
}

/** The evening before, from this hour: the folder is made and its link sent. */
export const FOLDER_AT_HOUR = 20;
/** The morning after: looked at every half hour in this window, published once photos are in. */
export const WATCH_FROM_HOUR = 7;
export const WATCH_UNTIL_HOUR = 15;
/** Every quarter of an hour (Ofer, 10-19). The tick runs every five minutes. */
const WATCH_EVERY_MS = 14 * 60_000;
/**
 * The first hour and a half of the morning (07:00–08:30, Ofer 10-20): the photos start
 * coming in then, so the folder is looked at on every tick. A doubled tick (two
 * minutes apart) still looks once.
 */
export const FAST_FROM_MIN = 7 * 60;
export const FAST_UNTIL_MIN = 8 * 60 + 30;
const FAST_EVERY_MS = 4 * 60_000;

/** How long since the last look before the folder is looked at again, at this Israel minute of the folder's own day. */
export function watchEveryMs(minuteOfDay: number, sameDay: boolean): number {
  return sameDay && minuteOfDay >= FAST_FROM_MIN && minuteOfDay <= FAST_UNTIL_MIN ? FAST_EVERY_MS : WATCH_EVERY_MS;
}

export async function editorIds(supabase: Db): Promise<string[]> {
  return qualitySessionRecipientIds(supabase, SUPER_USER_EMAIL);
}

/**
 * One tick of the automation (cron/tick, every five minutes). Two stages, each
 * idempotent through the ledger, so a missed or doubled tick changes nothing:
 *  1. from 20:00, if TOMORROW is a quality day: make its folder, tell the editors;
 *  2. from 07:00 on the folder's day until 15:00 the next, every half hour: once
 *     the folder has photos, publish the card with the first six; later photos fill
 *     it up to six, without a push. A folder made with autoFeed off is skipped.
 * Without Drive configured (driveWriter() null) it does nothing at all.
 */
export async function runSessionPhotoFolders(supabase: Db, now = new Date()): Promise<string[]> {
  const drive = driveWriter();
  if (!drive) return [];
  const fired: string[] = [];
  const { hour, minute } = israelNow(now);
  const today = israelToday(now);
  const ledger = await readFolderLedger(supabase);
  let dirty = false;

  // Folders whose time has come: tomorrow's plan day from 20:00 (as always), and any
  // day the Social screen scheduled or proposed with its own time (folders-plan).
  const nowLocal = `${today}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const due = new Set<string>();
  if (hour >= FOLDER_AT_HOUR) due.add(addDaysToDateStr(today, 1));
  for (const [date, e] of Object.entries(ledger)) {
    if (!e.folderId && !e.skipped && date >= today && createTimeOf(date, e) <= nowLocal) due.add(date);
  }
  for (const date of [...due].sort()) {
    const ahead = ledger[date];
    if (ahead?.folderId || ahead?.skipped) continue;
    if (ahead && createTimeOf(date, ahead) > nowLocal) continue;
    // Wanted by hand (a manual folder, a race switched on) or a day on the plan.
    const wanted = !!ahead && (ahead.manual || ahead.skipped === false);
    const workout = wanted ? null : await loadQualityWorkout(supabase, date);
    if (!wanted && !workout) continue;
    // 10-23: the Friday long run's folder opened as "אימון איכות" — the kind only looked at
    // `type === 'long_run'`, which plan workouts don't carry; `long` is what marks them.
    const kind: FolderKind = ahead?.kind || (isLong(workout) ? 'long' : 'quality');
    const name = ahead?.name || folderName(date, kind);
    const tags = ahead?.tags ?? suggestedTags(workout?.name || name);
    const folder = await ensureDayFolder(drive, date, name);
    await setFolderMeta(folder.id, { kind, tags }).catch((e) => console.warn('folder kind not set', e));
    ledger[date] = { ...ahead, folderId: folder.id, link: folder.link, name, createdAt: now.toISOString() };
    dirty = true;
    fired.push(`sessionFolder:${date}`);
    const entry = ledger[date];
    if (entry.notifyEditors !== false && !entry.toldAt) {
      for (const athleteId of await editorIds(supabase)) {
        try {
          await notifyAthlete({
            athleteId,
            kind: 'session_folder',
            copy: (locale) => sessionFolderReadyCopy(locale, { day: entry.manual ? name : sessionDayLabel(date) }),
            url: entry.link,
            tag: `session-folder-${date}`,
          });
        } catch { /* best effort */ }
      }
      entry.toldAt = now.toISOString();
    }
  }

  // The morning after (or the evening of, for a folder made by hand): from 07:00 on
  // the folder's day until 15:00 the next day, every half hour.
  for (const date of [addDaysToDateStr(today, -1), today]) {
    const entry = ledger[date];
    if (!entry || !entry.folderId || entry.skipped || entry.autoFeed === false) continue;
    const inWindow = date === today ? hour >= WATCH_FROM_HOUR : hour < WATCH_UNTIL_HOUR;
    const every = watchEveryMs(hour * 60 + minute, date === today);
    if (!inWindow || (entry.checkedAt && now.getTime() - Date.parse(entry.checkedAt) < every)) continue;
    entry.checkedAt = now.toISOString();
    dirty = true;
    const card = await cardFor(supabase, date);
    const have = card?.media?.length ?? 0;
    // A card published by hand with a different link is someone's choice: leave it.
    const ours = !card || toSessionPhotos(card.payload)?.link === entry.link;
    if (!ours || have >= MAX_SESSION_PHOTOS) continue;
    // Through the Drive API, subfolders included (a "צילומים שני" inside the day's folder);
    // the public grid scrape it replaced saw only the top level.
    const ids = await sessionPhotoIds(entry);
    if (!ids) continue;
    const list = { urls: ids };
    entry.found = ids.length;
    entry.previews = ids.slice(0, 3).map((id) => signedImageUrl(id, THUMB)).filter((u): u is string => !!u);
    if (!entry.autoPublish) {
      // Approval (the default since 10-19): nothing reaches the club by itself. The
      // editors hear ONCE, when the morning's first photos land ("מתחילות לעלות",
      // Ofer 10-20); after that the staff card's count moves and nobody is pushed
      // again. `notifiedCount` set is the ledger's "already told".
      const told = entry.notifiedCount ?? 0;
      const fresh = list.urls.length - Math.max(told, have);
      if (fresh > 0 && told === 0 && !card) {
        for (const athleteId of await editorIds(supabase)) {
          try {
            await notifyAthlete({
              athleteId,
              kind: 'session_folder',
              copy: (locale) => sessionPhotosStartedCopy(locale, { count: list.urls.length }),
              url: '/feed',
              tag: `session-photos-found-${date}`,
            });
          } catch { /* best effort */ }
        }
        fired.push(`sessionPhotosFound:${date}:${fresh}`);
      }
      if (fresh > 0) entry.notifiedCount = list.urls.length;
      continue;
    }
    if (list.urls.length <= have) continue;
    const pulled = await pullDrivePhotos(supabase, ids.slice(have), { prefix: `club/session-photos/${date}`, max: MAX_SESSION_PHOTOS - have });
    if (!pulled.ok) continue;
    const out = await publishSessionPhotos(supabase, {
      date, link: entry.link, media: [...(card?.media ?? []), ...pulled.media], byAthleteId: null, notify: !card, name: entry.name,
    });
    entry.publishedId = out.id;
    fired.push(`${card ? 'sessionPhotosMore' : 'sessionPhotos'}:${date}`);
  }

  if (dirty) await writeFolderLedger(supabase, ledger);
  return fired;
}

/**
 * A folder made by hand from the Social screen — any day, any name (a long run, a
 * race). One per day, like the automatic ones: asking again for a day that has one
 * returns it.
 */
export async function createFolderNow(
  supabase: Db,
  p: { date: string; name: string; notifyEditors: boolean; autoFeed: boolean; byAthleteId: string | null; kind?: FolderKind; tags?: string[]; createAt?: string },
  now = new Date(),
): Promise<FolderEntry | null> {
  const drive = driveWriter();
  if (!drive) return null;
  const ledger = await readFolderLedger(supabase);
  const { hour, minute } = israelNow(now);
  const nowLocal = `${israelToday(now)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  if (p.createAt && p.createAt > nowLocal && !ledger[p.date]?.folderId) {
    // "מתי ליצור" later: the entry waits in the ledger; the tick makes it (runSessionPhotoFolders).
    const entry: FolderEntry = {
      ...(ledger[p.date] || { folderId: '', link: '' }),
      name: p.name, manual: true, autoFeed: p.autoFeed, createAt: p.createAt,
      notifyEditors: p.notifyEditors, skipped: undefined,
      ...(p.kind ? { kind: p.kind } : {}), ...(p.tags ? { tags: p.tags } : {}),
    };
    ledger[p.date] = entry;
    await writeFolderLedger(supabase, ledger);
    return entry;
  }
  const folder = await ensureDayFolder(drive, p.date, p.name);
  // What the photos screen files it under (lib/photos/folder-kind): chosen when made.
  if (p.kind || p.tags?.length) await setFolderMeta(folder.id, { kind: p.kind, tags: p.tags }).catch((e) => console.warn('folder kind not set', e));
  const entry: FolderEntry = {
    ...(ledger[p.date] || {}),
    folderId: folder.id,
    link: folder.link,
    name: ledger[p.date]?.name || p.name,
    manual: ledger[p.date] ? ledger[p.date].manual : true,
    autoFeed: p.autoFeed,
    createdAt: ledger[p.date]?.createdAt || new Date().toISOString(),
  };
  if (p.notifyEditors && !entry.toldAt) {
    for (const athleteId of (await editorIds(supabase)).filter((id) => id !== p.byAthleteId)) {
      try {
        await notifyAthlete({
          athleteId,
          kind: 'session_folder',
          copy: (locale) => sessionFolderReadyCopy(locale, { day: entry.name || sessionDayLabel(p.date) }),
          url: entry.link,
          tag: `session-folder-${p.date}`,
        });
      } catch { /* best effort */ }
    }
    entry.toldAt = new Date().toISOString();
  }
  ledger[p.date] = entry;
  await writeFolderLedger(supabase, ledger);
  return entry;
}

export interface FolderProposal {
  date: string;
  name: string;
  workout: string | null;
  kind: FolderKind;
  tags: string[];
  /** Israel wall clock "YYYY-MM-DDTHH:MM". */
  createsAt: string;
  /** Off: no folder is made for the day (a race starts off; a plan day starts on). */
  enabled: boolean;
  source: 'plan' | 'race' | 'manual';
}

/**
 * What the Social screen's "מוצע השבוע" shows (folders-plan, Ofer 10-20): every day
 * ahead that wants a folder — the plan's quality and long runs, the calendar's races
 * (off until switched on), and folders scheduled by hand — each with its name, kind,
 * tags and time as edited; and the folders made.
 */
export async function socialWeek(supabase: Db, now = new Date()) {
  const today = israelToday(now);
  const ledger = await readFolderLedger(supabase);
  const last = addDaysToDateStr(today, 8);
  const { data: races } = await supabase.from('events').select('name, date').eq('kind', 'race').gte('date', today).lte('date', last);
  const raceOn = new Map(((races || []) as Array<{ name: string; date: string }>).map((r) => [r.date, r.name]));
  const upcoming: FolderProposal[] = [];
  for (let i = 0; i <= 8; i++) {
    const date = addDaysToDateStr(today, i);
    const e = ledger[date];
    if (e?.folderId) continue;
    const w = await loadQualityWorkout(supabase, date).catch(() => null);
    const race = raceOn.get(date);
    const source: FolderProposal['source'] | null = w ? 'plan' : race ? 'race' : e?.manual ? 'manual' : null;
    if (!source) continue;
    const workout = w?.name || race || null;
    const name = e?.name || (source === 'race' ? race! : folderName(date, isLong(w) ? 'long' : 'quality'));
    const createsAt = createTimeOf(date, e);
    // A time already past with no folder: the next tick makes it (only tomorrow's default waits for 20:00).
    upcoming.push({
      date, name, workout, createsAt,
      kind: e?.kind || (source === 'race' ? 'race' : isLong(w) ? 'long' : source === 'manual' ? 'event' : 'quality'),
      tags: e?.tags ?? suggestedTags(workout || name),
      enabled: source === 'race' ? e?.skipped === false : !e?.skipped,
      source,
    });
  }
  const made = await Promise.all(Object.entries(ledger).filter(([, e]) => e.folderId).sort(([a], [b]) => b.localeCompare(a)).map(async ([date, e]) => {
    const card = await cardFor(supabase, date);
    return {
      date, name: e.name || folderName(date), link: e.link, manual: !!e.manual, autoFeed: e.autoFeed !== false,
      photos: card?.media?.length ?? 0, inFeed: !!card,
      // When it was opened, and what the last check found in it (Content v4's locked rows).
      createdAt: e.createdAt ?? null, found: e.found ?? null,
    };
  }));
  return { configured: !!driveWriter(), upcoming, made };
}

export type PhotosNotify = 'push' | 'inapp' | 'quiet';

/**
 * The day's folder's photos, subfolders included, by Drive id (lib/photos/drive-browse).
 * Null when Drive is not configured or the folder is not one the club's Drive reads.
 */
async function sessionPhotoIds(entry: FolderEntry): Promise<string[] | null> {
  const photos = await folderPhotosNow(entry.folderId).catch(() => null);
  return photos ? photos.map((p) => p.id) : null;
}

/**
 * The staff card's "לפרסם" (mockup session-photos-control, 3): pull what is in the folder
 * into the day's card, then tell the club the way the editor chose: a push (which also
 * lands in the in-app inbox), the in-app inbox only, or nothing. `circle` also puts
 * "התמונות עלו" in the Madregot circle for the day. A card already published is topped
 * up; who was told before is not told again.
 */
export async function approveSessionPhotos(
  supabase: Db,
  p: { date: string; notify: PhotosNotify; audience: 'all' | 'attendees'; circle: boolean; byAthleteId: string | null; byEmail?: string | null },
): Promise<{ id: string; photos: number; told: number }> {
  const ledger = await readFolderLedger(supabase);
  const entry = ledger[p.date];
  if (!entry?.folderId) throw new Error('no folder for that day');
  const card = await cardFor(supabase, p.date);
  const have = card?.media?.length ?? 0;
  let media = card?.media ?? [];
  if (have < MAX_SESSION_PHOTOS) {
    const ids = await sessionPhotoIds(entry);
    const pulled = ids
      ? await pullDrivePhotos(supabase, ids.slice(have), { prefix: `club/session-photos/${p.date}`, max: MAX_SESSION_PHOTOS - have })
      : await pullAlbumPhotos(supabase, entry.link, { prefix: `club/session-photos/${p.date}`, max: MAX_SESSION_PHOTOS - have, skip: have });
    if (pulled.ok) media = [...media, ...pulled.media];
    else if (!have) throw new Error(pulled.error);
  }
  const out = await publishSessionPhotos(supabase, { date: p.date, link: entry.link, media, byAthleteId: p.byAthleteId, notify: false, name: entry.name });
  let told = 0;
  if (!card && p.notify !== 'quiet') {
    const workoutName = (await loadQualityWorkout(supabase, p.date).catch(() => null))?.name || null;
    if (p.notify === 'push') {
      const ids = p.audience === 'attendees' ? await attendees(supabase, p.date) : await clubMembers(supabase);
      for (const athleteId of ids.filter((id) => id !== p.byAthleteId)) {
        try {
          await notifyAthlete({
            athleteId, kind: 'session_photos', actorAthleteId: p.byAthleteId,
            copy: (locale) => sessionPhotosCopy(locale, { workout: workoutName, event: entry.name }),
            url: `/feed?item=${out.id}`, tag: `session-photos-${p.date}`,
          });
          told += 1;
        } catch { /* one phone must not stop the rest */ }
      }
    } else {
      // In the app only: one row in everyone's inbox (api/notifications/inbox), no push.
      const copy = sessionPhotosCopy('he', { workout: workoutName, event: entry.name });
      const ids = p.audience === 'attendees' ? await attendees(supabase, p.date) : null;
      const rows = ids
        ? ids.map((id) => ({ audience_type: 'athlete', audience_id: id }))
        : [{ audience_type: 'all', audience_id: null }];
      const now = new Date().toISOString();
      const { error } = await supabase.from('scheduled_notifications').insert(rows.map((r) => ({
        kind: 'session_photos', title_he: copy.title, body_he: copy.body, url: `/feed?item=${out.id}`,
        ...r, schedule_type: 'now', next_run_at: now, status: 'sent', last_sent_at: now, sent_count: 0, created_by: p.byEmail ?? null,
      })));
      if (!error) told = ids ? ids.length : -1;
    }
  }
  if (p.circle) {
    const { CLUB_STORIES_KEY, PHOTOS_STORY_LABEL, photosFolderHref, pruneClubStories, readClubStories } = await import('@/lib/feed/club-stories');
    const { data } = await supabase.from('app_settings').select('value').eq('key', CLUB_STORIES_KEY).maybeSingle();
    const list = readClubStories((data as { value?: string } | null)?.value);
    const today = israelToday();
    // With the way to them (Ofer, 2026-10-23: "the circle has no link to the photos"): the
    // session's folder in the app, or the feed card when the folder is not known.
    const folderId = ledger[p.date]?.folderId;
    list.unshift({
      id: `photos-${p.date}`, title: '📸 התמונות מהאימון עלו', text: 'כל התמונות של האימון — לחיצה על הכפתור.',
      from: today, until: today, createdAt: new Date().toISOString(), createdBy: p.byEmail ?? null,
      href: folderId ? photosFolderHref(folderId) : `/feed?item=${out.id}`, label: PHOTOS_STORY_LABEL,
    });
    await supabase.from('app_settings').upsert({ key: CLUB_STORIES_KEY, value: JSON.stringify(pruneClubStories(list.filter((s, i) => i === 0 || s.id !== `photos-${p.date}`), today)) }, { onConflict: 'key' });
  }
  entry.publishedId = out.id;
  entry.notifiedCount = Math.max(entry.notifiedCount ?? 0, entry.found ?? 0);
  await writeFolderLedger(supabase, ledger);
  return { id: out.id, photos: media.length, told };
}

/** The staff card's read: today's folder (or yesterday's, until 15:00) as the morning check left it. */
export async function sessionPhotosStatus(supabase: Db, now = new Date()) {
  const { hour } = israelNow(now);
  const today = israelToday(now);
  const ledger = await readFolderLedger(supabase);
  // Only a folder that was made (one named ahead or skipped on "תחילת שבוע" is not one).
  const made = (d: string) => !!ledger[d]?.folderId && !ledger[d]?.skipped;
  const date = made(today) && hour >= WATCH_FROM_HOUR ? today : made(addDaysToDateStr(today, -1)) && hour < WATCH_UNTIL_HOUR ? addDaysToDateStr(today, -1) : null;
  if (!date) return null;
  const e = ledger[date];
  if (e.autoFeed === false) return null;
  const card = await cardFor(supabase, date);
  const workout = (await loadQualityWorkout(supabase, date).catch(() => null))?.name || null;
  const checkedAt = e.checkedAt ?? null;
  return {
    date, name: e.name ?? folderName(date), workout, link: e.link, auto: !!e.autoPublish,
    checkedAt, nextAt: checkedAt ? new Date(Date.parse(checkedAt) + 15 * 60_000).toISOString() : null,
    found: e.found ?? 0, previews: e.previews ?? [], published: card?.media?.length ?? 0, publishedId: card?.id ?? null,
  };
}

/** The staff card's "לפרסם לבד" switch for one day. */
export async function setSessionPhotosAuto(supabase: Db, date: string, on: boolean): Promise<void> {
  const ledger = await readFolderLedger(supabase);
  if (!ledger[date]?.folderId) return;
  ledger[date].autoPublish = on;
  await writeFolderLedger(supabase, ledger);
}
/**
 * One day's folder, changed from "תחילת שבוע": a new name (renamed in Drive too), the
 * feed card on or off, or no folder at all for the day (`skipped` — the evening-before
 * automation then leaves it; a folder already made stays in Drive, only forgotten here).
 * `skipped: false` undoes that. Returns the entry as it now stands.
 */
export async function updateDayFolder(
  supabase: Db,
  date: string,
  patch: { name?: string; autoFeed?: boolean; skipped?: boolean; kind?: FolderKind; tags?: string[]; createAt?: string | null },
): Promise<FolderEntry | null> {
  const ledger = await readFolderLedger(supabase);
  const entry: FolderEntry = { ...(ledger[date] || { folderId: '', link: '' }) };
  if (patch.name && patch.name.trim()) {
    // Not made yet: the name waits in the ledger for the evening-before automation.
    const drive = entry.folderId ? driveWriter() : null;
    if (drive) await drive.files.update({ fileId: entry.folderId, requestBody: { name: patch.name.trim() }, supportsAllDrives: true });
    entry.name = patch.name.trim();
  }
  if (typeof patch.autoFeed === 'boolean') entry.autoFeed = patch.autoFeed;
  // false is kept: it is a race switched ON (a race is off until then).
  if (typeof patch.skipped === 'boolean') entry.skipped = patch.skipped;
  if (patch.kind || patch.tags) {
    if (patch.kind) entry.kind = patch.kind;
    if (patch.tags) entry.tags = patch.tags;
    if (entry.folderId) await setFolderMeta(entry.folderId, { kind: entry.kind, tags: entry.tags }).catch((e) => console.warn('folder kind not set', e));
  }
  if (patch.createAt !== undefined && !entry.folderId) entry.createAt = patch.createAt || undefined;
  const empty = !entry.folderId && entry.skipped === undefined && !entry.name && entry.autoFeed !== false && !entry.kind && !entry.tags && !entry.createAt && !entry.manual;
  if (empty) delete ledger[date];
  else ledger[date] = entry;
  await writeFolderLedger(supabase, ledger);
  return ledger[date] ?? null;
}

