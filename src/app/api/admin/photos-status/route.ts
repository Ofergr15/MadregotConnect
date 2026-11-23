import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/features/server';
import { listPhotoFolders } from '@/lib/photos/drive-browse';
import { folderSessions, photosStatus } from '@/lib/photos/status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/photos-status — Drive photos v2 (night queue #101). Staff only (verified JWT); 404 while
 * `photos_drive_v2` is off for the caller.
 *
 * → { sourceConfigured, mirror: { on, lastRun, hoursSince }, folders: [{ id, name, title, date, count, videos,
 *     session: { workout, events } }] } — the folder list is the stored listing the cron builds (no Drive call
 *     here), newest first, each tied to the club's plan workout and events of its day.
 *
 * Reads only. The mirror switch (`photos_mirror`) is not writable here — it stays the owner's decision.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isStaff && !caller.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isFeatureEnabled('photos_drive_v2', caller.athleteId).catch(() => false))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const db = createServerClient();
    const [status, folders] = await Promise.all([photosStatus(db), listPhotoFolders().catch(() => null)]);
    const list = folders ?? [];
    const sessions = await folderSessions(db, list.map((f) => f.date)).catch(() => new Map());
    return NextResponse.json({
      ...status,
      folders: list.map((f) => ({
        id: f.id, name: f.name, title: f.title, date: f.date, count: f.count, videos: f.videos,
        session: sessions.get(f.date) ?? null,
      })),
    });
  } catch (err) {
    console.error('[api/admin/photos-status]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
