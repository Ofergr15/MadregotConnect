import type { createServerClient } from '@/lib/supabase/server';
import { notifyAthlete } from '@/lib/push';
import { addDaysToDateStr, israelNow, israelToday } from '@/lib/utils';
import { SUPER_USER_EMAIL } from '@/lib/constants';
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
export interface FolderEntry { folderId: string; link: string; toldAt?: string; checkedAt?: string; publishedId?: string }
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

/** Who marked "coming" that morning. Attendance weeks start on Sunday. */
async function attendees(supabase: Db, date: string): Promise<string[]> {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data } = await supabase.from('workout_attendance')
    .select('athlete_id')
    .eq('week_start_date', addDaysToDateStr(date, -dow))
    .eq('day_of_week', dow)
    .eq('attending', true);
  return [...new Set(((data || []) as Array<{ athlete_id: string }>).map((r) => r.athlete_id))];
}

/**
 * The day's card: published, or updated in place (one card per day). Members who
 * marked "coming" are told on the first publish only, and only with `notify`.
 */
export async function publishSessionPhotos(
  supabase: Db,
  p: { date: string; link: string; media: PulledMedia[]; byAthleteId: string | null; notify: boolean },
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
    for (const athleteId of (await attendees(supabase, p.date)).filter((id) => id !== p.byAthleteId)) {
      try {
        await notifyAthlete({
          athleteId,
          kind: 'session_photos',
          actorAthleteId: p.byAthleteId,
          copy: (locale) => sessionPhotosCopy(locale, { workout: workoutName }),
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
const WATCH_EVERY_MS = 25 * 60_000;

async function editorIds(supabase: Db): Promise<string[]> {
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
 *  2. 07:00-15:00 on the day, every half hour: once the folder has photos, publish
 *     the card with the first six; later photos fill it up to six, without a push.
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
      ledger[tomorrow] = { folderId: folder.id, link: folder.link };
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

  const entry = ledger[today];
  if (entry && hour >= WATCH_FROM_HOUR && hour < WATCH_UNTIL_HOUR
    && (!entry.checkedAt || now.getTime() - Date.parse(entry.checkedAt) >= WATCH_EVERY_MS)) {
    entry.checkedAt = now.toISOString();
    dirty = true;
    const card = await cardFor(supabase, today);
    const have = card?.media?.length ?? 0;
    // A card published by hand with a different link is someone's choice: leave it.
    const ours = !card || toSessionPhotos(card.payload)?.link === entry.link;
    if (ours && have < MAX_SESSION_PHOTOS) {
      const list = await albumPhotoUrls(entry.link);
      if (list.ok && list.urls.length > have) {
        const pulled = await pullAlbumPhotos(supabase, entry.link, {
          prefix: `club/session-photos/${today}`, max: MAX_SESSION_PHOTOS - have, skip: have,
        });
        if (pulled.ok) {
          const out = await publishSessionPhotos(supabase, {
            date: today, link: entry.link, media: [...(card?.media ?? []), ...pulled.media], byAthleteId: null, notify: !card,
          });
          entry.publishedId = out.id;
          fired.push(`${card ? 'sessionPhotosMore' : 'sessionPhotos'}:${today}`);
        }
      }
    }
  }

  if (dirty) await writeFolderLedger(supabase, ledger);
  return fired;
}
