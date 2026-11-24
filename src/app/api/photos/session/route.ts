import { NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { createServerClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/features/server';
import { listFolderPhotos } from '@/lib/photos/drive-browse';
import { folderSessions } from '@/lib/photos/status';
import { readFolderLedger } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/photos/session?folderId=… — "which session is this album" for a member (photos_drive_v2).
 * → { date, workout: { name, planId } | null, events: [{ id, name }], feedItemId: string | null }
 *
 * Read off the same sources the staff status route uses: the album's date, the group plan's workout that day,
 * that day's events, and the session_photo_folders ledger entry whose folderId is this album (its published
 * feed card, if any). Nothing about who attended. 404 for a folder outside the session-photos library.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!(await isFeatureEnabled('photos_drive_v2', caller.athleteId).catch(() => false))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const folderId = new URL(request.url).searchParams.get('folderId') ?? '';
  try {
    const album = await listFolderPhotos(folderId);
    if (!album) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const db = createServerClient();
    const [sessions, ledger] = await Promise.all([
      folderSessions(db, [album.folder.date]).catch(() => new Map()),
      readFolderLedger(db).catch(() => ({} as Awaited<ReturnType<typeof readFolderLedger>>)),
    ]);
    const s = sessions.get(album.folder.date) ?? { workout: null, events: [] };
    const entry = Object.values(ledger).find((e) => e?.folderId === folderId);
    return NextResponse.json({ date: album.folder.date, workout: s.workout, events: s.events, feedItemId: entry?.publishedId ?? null });
  } catch (err) {
    console.error('[api/photos/session]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
