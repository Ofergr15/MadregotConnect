import { NextResponse } from 'next/server';
import { clubUpdatesCaller } from '@/lib/club-updates/access';
import { UUID_RE, listTopics } from '@/lib/club-updates/server';

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
