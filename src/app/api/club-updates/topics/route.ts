import { NextResponse } from 'next/server';
import { clubUpdatesCaller, forbidden } from '@/lib/club-updates/access';
import { UUID_RE, isMissingTable, listTopics } from '@/lib/club-updates/server';

export const dynamic = 'force-dynamic';

/** GET /api/club-updates/topics[?event=<uuid>] — the topics updates are grouped under. Same gate as the stream. */
export async function GET(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.canRead) return NextResponse.json({ enabled: false, topics: [] });
  const eventId = new URL(request.url).searchParams.get('event');
  if (eventId !== null && !UUID_RE.test(eventId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const { topics, missing } = await listTopics(c.db, eventId !== null ? { eventId } : {});
    return NextResponse.json({ enabled: c.cfg.enabled, missing, topics });
  } catch (err) {
    console.error('[club-updates] topics read failed:', err);
    return NextResponse.json({ error: 'Failed to read topics' }, { status: 500 });
  }
}

/**
 * POST /api/club-updates/topics { name, eventId?, pinnedText? } — an admin opens a topic (e.g. one race).
 * Admin only (`capabilities.clubUpdates.admin`). Sends nothing: a topic is a heading, not an update.
 * `eventId` must be an existing event. 503 before migration 154.
 */
export async function POST(request: Request) {
  const c = await clubUpdatesCaller(request);
  if (c.denied) return c.denied;
  if (!c.access.admin) return forbidden();
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 80) return NextResponse.json({ error: 'name required (≤80)' }, { status: 400 });
  const pinnedText = b?.pinnedText == null ? null : typeof b.pinnedText === 'string' ? b.pinnedText.trim().slice(0, 280) || null : undefined;
  if (pinnedText === undefined) return NextResponse.json({ error: 'invalid pinnedText' }, { status: 400 });
  let eventId: string | null = null;
  if (b?.eventId != null) {
    if (typeof b.eventId !== 'string' || !UUID_RE.test(b.eventId)) return NextResponse.json({ error: 'invalid eventId' }, { status: 400 });
    const { data: ev, error: evErr } = await c.db.from('events').select('id').eq('id', b.eventId).maybeSingle();
    if (evErr) return NextResponse.json({ error: 'Failed to read event' }, { status: 500 });
    if (!ev) return NextResponse.json({ error: 'unknown event' }, { status: 400 });
    eventId = b.eventId;
  }
  const { data, error } = await c.db.from('club_update_topics')
    .insert({ name, event_id: eventId, pinned_text: pinnedText, created_by: c.athleteId })
    .select('id, name, event_id, pinned_text, opens_at, closes_at').single();
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'migration 154 not applied' }, { status: 503 });
    console.error('[club-updates] topic insert failed:', error);
    return NextResponse.json({ error: 'Failed to create topic' }, { status: 500 });
  }
  const t = data as { id: string; name: string; event_id: string | null; pinned_text: string | null; opens_at: string; closes_at: string | null };
  return NextResponse.json({
    topic: { id: t.id, eventId: t.event_id, name: t.name, pinnedText: t.pinned_text, opensAt: t.opens_at, closesAt: t.closes_at },
  });
}
