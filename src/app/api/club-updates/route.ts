import { invalidateShared, SHARED_TAGS } from '@/lib/cache/shared';
import { NextResponse, after } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { UUID_RE, isMissingTable, listTopics, listUpdates, project, sendUpdatePush, wantsPush, type UpdateRow } from '@/lib/club-updates/server';
import { FEED_MS, MAX_CHARS, UNDO_MS, visibleLength } from '@/lib/club-updates/model';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET  /api/club-updates[?feed=1]  — the stream (newest first, pinned ones with it), or for
 *      the feed card only the last day's three. `{ enabled:false }` for a member while the
 *      admin has it off, so nothing renders.
 *      ?topic=<uuid> / ?event=<uuid> narrow it to one topic / that event's topics and add `topic`.
 * POST /api/club-updates { body, imageUrl?, breaking?, pinned?, topicId? } — a writer's new update.
 *      A breaking one or a tag pushes after UNDO_MS, unless it was deleted (ביטול) by then.
 */
export async function GET(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  const { access } = c;
  if (!access.canRead) return NextResponse.json({ enabled: false, updates: [] });
  const params = new URL(request.url).searchParams;
  const feed = params.get('feed') === '1';
  const topicId = params.get('topic');
  const eventId = params.get('event');
  if ((topicId !== null && !UUID_RE.test(topicId)) || (eventId !== null && !UUID_RE.test(eventId))) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const base = feed ? { limit: 3, since: new Date(Date.now() - FEED_MS).toISOString() } : { limit: 80 };
    if (topicId === null && eventId === null) {
      const { updates, missing } = await listUpdates(c.db, c.athleteId, base);
      return NextResponse.json({
        enabled: c.cfg.enabled, canWrite: access.canWrite, admin: access.admin, me: c.athleteId, missing, updates,
      });
    }
    // Filtered: "updates for this topic / this event". Unknown → empty, never the whole stream.
    const t = await listTopics(c.db, {
      ...(topicId !== null ? { ids: [topicId] } : {}),
      ...(eventId !== null ? { eventId } : {}),
    });
    const { updates, missing } = t.missing
      ? { updates: [], missing: true }
      : await listUpdates(c.db, c.athleteId, { ...base, topicIds: t.topics.map((x) => x.id) });
    return NextResponse.json({
      enabled: c.cfg.enabled, canWrite: access.canWrite, admin: access.admin, me: c.athleteId, missing, updates,
      topic: t.topics[0] ?? null,
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
  let topicId: string | null = null;
  if (b?.topicId !== undefined && b?.topicId !== null) {
    if (typeof b.topicId !== 'string' || !UUID_RE.test(b.topicId)) return NextResponse.json({ error: 'invalid topicId' }, { status: 400 });
    const { data: topic, error: tErr } = await c.db.from('club_update_topics').select('id').eq('id', b.topicId).maybeSingle();
    if (tErr && isMissingTable(tErr)) return NextResponse.json({ error: 'migration 154 not applied' }, { status: 503 });
    if (tErr) return NextResponse.json({ error: 'Failed to read topic' }, { status: 500 });
    if (!topic) return NextResponse.json({ error: 'unknown topic' }, { status: 400 });
    topicId = b.topicId;
  }
  const push = wantsPush(body, breaking, c.athleteId);
  const { data, error } = await c.db.from('club_updates').insert({
    author_athlete_id: c.athleteId, body, image_url: imageUrl, breaking, pinned: b?.pinned === true,
    ...(topicId ? { topic_id: topicId } : {}),
    notify_at: push ? new Date(Date.now() + UNDO_MS).toISOString() : null,
  }).select('*').single();
  invalidateShared(SHARED_TAGS.clubUpdates);
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
