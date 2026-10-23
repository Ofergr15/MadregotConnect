/**
 * POST /api/photos/video-timing — how fast a video really started, on a real phone
 * (Ofer, 10-23: "measure the times"). The player posts one line per video it starts and
 * one when it leaves it; this route only writes them to the server log, read with
 * `vercel logs -q video-timing`. No table: these are measurements for a tuning pass, kept
 * as long as the logs are, and nothing in them is personal — a Drive file id, numbers,
 * and the kind of phone.
 */
import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);

export async function POST(request: Request) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const b = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: 'bad body' }, { status: 400 });
  const ua = request.headers.get('user-agent') || '';
  const line = {
    event: pick(b.event, ['start', 'leave'] as const),
    id: typeof b.id === 'string' ? b.id.slice(0, 64) : null,
    how: pick(b.how, ['open', 'swipe'] as const),
    path: pick(b.path, ['copy', 'original'] as const),
    // ms from the finger (the tile's touch, or the swipe's first move) to a frame on screen
    firstFrameMs: num(b.firstFrameMs, 120_000),
    // was the next video already holding its opening when it landed (readyState >= 3)?
    preloaded: typeof b.preloaded === 'boolean' ? b.preloaded : null,
    height: num(b.height, 4320),
    watchedS: num(b.watchedS, 3600),
    stalls: num(b.stalls, 1000),
    stallMs: num(b.stallMs, 3_600_000),
    phone: /iPhone|iPad/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other',
    v: typeof b.v === 'string' ? b.v.slice(0, 16) : null,
  };
  if (!line.event || !line.id) return NextResponse.json({ error: 'bad body' }, { status: 400 });
  console.log('[video-timing]', JSON.stringify(line));
  return new NextResponse(null, { status: 204 });
}
