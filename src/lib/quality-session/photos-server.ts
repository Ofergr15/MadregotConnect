import type { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { sessionPhotosFoundCopy } from '@/lib/notifications/copy';
import { addDaysToDateStr, israelNow, israelToday } from '@/lib/utils';
import { COACH_ID, SUPER_USER_EMAIL } from '@/lib/constants';
import { sessionFolderReadyCopy, sessionPhotosCopy } from '@/lib/notifications/copy';
import { driveWriter, ensureDayFolder } from '@/lib/google-drive/writer';
import { loadQualityWorkout } from './server';
import { storyEditorIds } from './access';
import { albumPhotoUrls, pullAlbumPhotos, type PulledMedia } from './album-fetch';
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

/** "אימון איכות · שלישי 13.10" — the folder's name in Drive. */
export function folderName(date: string): string {
  return `אימון איכות · ${sessionDayLabel(date)}`;
}

/** The evening before, from this hour: the folder is made and its link sent. */
export const FOLDER_AT_HOUR = 20;
/** The morning after: looked at every half hour in this window, published once photos are in. */
export const WATCH_FROM_HOUR = 7;
export const WATCH_UNTIL_HOUR = 15;
/** Every quarter of an hour (Ofer, 10-19). The tick runs every five minutes. */
const WATCH_EVERY_MS = 14 * 60_000;

export async function editorIds(supabase: Db): Promise<string[]> {
  const [editors, superRow] = await Promise.all([
    storyEditorIds(supabase),
    supabase.from('athletes').select('id').eq('email', SUPER_USER_EMAIL).maybeSingle(),
  ]);
  return [...new Set([...(editors || []), ...((superRow.data as { id?: string } | null)?.id ? [(superRow.data as { id: string }).id] : [])])];
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
  const { hour } = israelNow(now);
  const today = israelToday(now);
  const ledger = await readFolderLedger(supabase);
  let dirty = false;

  if (hour >= FOLDER_AT_HOUR) {
    const tomorrow = addDaysToDateStr(today, 1);
    if (!ledger[tomorrow] && (await loadQualityWorkout(supabase, tomorrow))) {
      const folder = await ensureDayFolder(drive, tomorrow, folderName(tomorrow));
      ledger[tomorrow] = { folderId: folder.id, link: folder.link, name: folderName(tomorrow), createdAt: now.toISOString() };
      dirty = true;
      fired.push(`sessionFolder:${tomorrow}`);
    }
    const entry = ledger[tomorrow];
    if (entry && !entry.toldAt) {
      for (const athleteId of await editorIds(supabase)) {
        try {
          await notifyAthlete({
            athleteId,
            kind: 'session_folder',
            copy: (locale) => sessionFolderReadyCopy(locale, { day: sessionDayLabel(tomorrow) }),
            url: entry.link,
            tag: `session-folder-${tomorrow}`,
          });
        } catch { /* best effort */ }
      }
      entry.toldAt = now.toISOString();
      dirty = true;
    }
  }

  // The morning after (or the evening of, for a folder made by hand): from 07:00 on
  // the folder's day until 15:00 the next day, every half hour.
  for (const date of [addDaysToDateStr(today, -1), today]) {
    const entry = ledger[date];
    if (!entry || entry.autoFeed === false) continue;
    const inWindow = date === today ? hour >= WATCH_FROM_HOUR : hour < WATCH_UNTIL_HOUR;
    if (!inWindow || (entry.checkedAt && now.getTime() - Date.parse(entry.checkedAt) < WATCH_EVERY_MS)) continue;
    entry.checkedAt = now.toISOString();
    dirty = true;
    const card = await cardFor(supabase, date);
    const have = card?.media?.length ?? 0;
    // A card published by hand with a different link is someone's choice: leave it.
    const ours = !card || toSessionPhotos(card.payload)?.link === entry.link;
    if (!ours || have >= MAX_SESSION_PHOTOS) continue;
    const list = await albumPhotoUrls(entry.link);
    if (!list.ok) continue;
    entry.found = list.urls.length;
    entry.previews = list.urls.slice(0, 3);
    if (!entry.autoPublish) {
      // Approval (the default since 10-19): nothing reaches the club by itself. The
      // editors hear once per new batch; the staff card at the top of their feed decides.
      const told = entry.notifiedCount ?? 0;
      const fresh = list.urls.length - Math.max(told, have);
      if (fresh > 0) {
        for (const athleteId of await editorIds(supabase)) {
          try {
            await notifyAthlete({
              athleteId,
              kind: 'session_folder',
              copy: (locale) => sessionPhotosFoundCopy(locale, { count: fresh, first: !card && told === 0 }),
              url: '/feed',
              tag: `session-photos-found-${date}`,
            });
          } catch { /* best effort */ }
        }
        entry.notifiedCount = list.urls.length;
        fired.push(`sessionPhotosFound:${date}:${fresh}`);
      }
      continue;
    }
    if (list.urls.length <= have) continue;
    const pulled = await pullAlbumPhotos(supabase, entry.link, {
      prefix: `club/session-photos/${date}`, max: MAX_SESSION_PHOTOS - have, skip: have,
    });
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
  p: { date: string; name: string; notifyEditors: boolean; autoFeed: boolean; byAthleteId: string | null },
): Promise<FolderEntry | null> {
  const drive = driveWriter();
  if (!drive) return null;
  const ledger = await readFolderLedger(supabase);
  const folder = await ensureDayFolder(drive, p.date, p.name);
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

/** What the Social screen's "this week" shows: the quality days ahead, and the folders made. */
export async function socialWeek(supabase: Db, now = new Date()) {
  const today = israelToday(now);
  const ledger = await readFolderLedger(supabase);
  const upcoming: Array<{ date: string; name: string; workout: string | null; createsAt: string }> = [];
  for (let i = 0; i <= 8; i++) {
    const date = addDaysToDateStr(today, i);
    if (ledger[date]) continue;
    const w = await loadQualityWorkout(supabase, date).catch(() => null);
    // A folder for today that the evening before did not make is made on the next tick.
    if (w) upcoming.push({ date, name: folderName(date), workout: w.name || null, createsAt: `${addDaysToDateStr(date, -1)}T20:00` });
  }
  const made = await Promise.all(Object.entries(ledger).sort(([a], [b]) => b.localeCompare(a)).map(async ([date, e]) => {
    const card = await cardFor(supabase, date);
    return {
      date, name: e.name || folderName(date), link: e.link, manual: !!e.manual, autoFeed: e.autoFeed !== false,
      photos: card?.media?.length ?? 0, inFeed: !!card,
    };
  }));
  return { configured: !!driveWriter(), upcoming, made };
}


export type PhotosNotify = 'push' | 'inapp' | 'quiet';

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
  if (!entry) throw new Error('no folder for that day');
  const card = await cardFor(supabase, p.date);
  const have = card?.media?.length ?? 0;
  let media = card?.media ?? [];
  if (have < MAX_SESSION_PHOTOS) {
    const pulled = await pullAlbumPhotos(supabase, entry.link, { prefix: `club/session-photos/${p.date}`, max: MAX_SESSION_PHOTOS - have, skip: have });
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
    const { CLUB_STORIES_KEY, pruneClubStories, readClubStories } = await import('@/lib/feed/club-stories');
    const { data } = await supabase.from('app_settings').select('value').eq('key', CLUB_STORIES_KEY).maybeSingle();
    const list = readClubStories((data as { value?: string } | null)?.value);
    const today = israelToday();
    list.unshift({ id: `photos-${p.date}`, title: '📸 התמונות מהאימון עלו', text: 'לחיצה על הכרטיס בפיד פותחת את כולן', from: today, until: today, createdAt: new Date().toISOString(), createdBy: p.byEmail ?? null });
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
  const date = ledger[today] && hour >= WATCH_FROM_HOUR ? today : ledger[addDaysToDateStr(today, -1)] && hour < WATCH_UNTIL_HOUR ? addDaysToDateStr(today, -1) : null;
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
  if (!ledger[date]) return;
  ledger[date].autoPublish = on;
  await writeFolderLedger(supabase, ledger);
}
