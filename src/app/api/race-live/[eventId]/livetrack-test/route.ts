import { NextRequest, NextResponse } from 'next/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { parseLiveTrackUrl, testLiveTrack } from '@/lib/race-live/livetrack';

export const dynamic = 'force-dynamic';

// POST { url } → { ok, state: ready|active } | { ok:false, code }. Any verified member, for a link
// they are about to save; reads Garmin once and returns no track data. Rate: one per 10 s per caller.
const last = new Map<string, number>();

export async function POST(request: NextRequest) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const key = caller.athleteId || caller.email;
  const now = Date.now();
  if (now - (last.get(key) ?? 0) < 10_000) return NextResponse.json({ ok: false, code: 'slow_down' }, { status: 429 });
  last.set(key, now);
  const body = await request.json().catch(() => ({}));
  const link = parseLiveTrackUrl(body.url);
  if (!link) return NextResponse.json({ ok: false, code: 'not_livetrack' }, { status: 400 });
  return NextResponse.json(await testLiveTrack(link));
}
