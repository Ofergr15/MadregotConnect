import { NextResponse, after } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { isMissingTable, listUpdates, project, sendUpdatePush, wantsPush, type UpdateRow } from '@/lib/club-updates/server';
import { FEED_MS, MAX_CHARS, UNDO_MS, visibleLength } from '@/lib/club-updates/model';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET  /api/club-updates[?feed=1]  — the stream (newest first, pinned ones with it), or for
 *      the feed card only the last day's three. `{ enabled:false }` for a member while the
 *      admin has it off, so nothing renders.
 * POST /api/club-updates { body, imageUrl?, breaking?, pinned? } — a writer's new update.
 *      A breaking one or a tag pushes after UNDO_MS, unless it was deleted (ביטול) by then.
 */
export async function GET(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  const { access } = c;
  if (!access.canRead) return NextResponse.json({ enabled: false, updates: [] });
  const feed = new URL(request.url).searchParams.get('feed') === '1';
  try {
    const { updates, missing } = await listUpdates(c.db, c.athleteId, feed
      ? { limit: 3, since: new Date(Date.now() - FEED_MS).toISOString() }
      : { limit: 80 });
    return NextResponse.json({
      enabled: c.cfg.enabled, canWrite: access.canWrite, admin: access.admin, me: c.athleteId, missing, updates,
    });
  } catch (err) {
    console.error('[club-updates] read failed:', err);
    return NextResponse.json({ error: 'Failed to read updates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.canWrite || !c.athleteId) return forbidden();
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (visibleLength(body) > MAX_CHARS) return NextResponse.json({ error: `עד ${MAX_CHARS} תווים` }, { status: 400 });
  const imageUrl = typeof b?.imageUrl === 'string' && /^https:\/\//.test(b.imageUrl) ? b.imageUrl : null;
  const breaking = b?.breaking === true;
  const push = wantsPush(body, breaking, c.athleteId);
  const { data, error } = await c.db.from('club_updates').insert({
    author_athlete_id: c.athleteId, body, image_url: imageUrl, breaking, pinned: b?.pinned === true,
    notify_at: push ? new Date(Date.now() + UNDO_MS).toISOString() : null,
  }).select('*').single();
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'migration 154 not applied' }, { status: 503 });
    console.error('[club-updates] insert failed:', error);
    return NextResponse.json({ error: 'Failed to publish' }, { status: 500 });
  }
  const row = data as UpdateRow;
  // The push waits out the undo window here rather than in a cron, so it goes in seconds.
  if (push) after(async () => {
    await new Promise((r) => setTimeout(r, UNDO_MS));
    await sendUpdatePush(c.db, row.id);
  });
  const [update] = await project(c.db, [row], c.athleteId);
  return NextResponse.json({ update, push });
}
