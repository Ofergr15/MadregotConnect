import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isPointKey, parseClock } from '@/lib/race-live/core';
import { announceMilestones, postFinisherCard, storeSplits, type RaceConfig } from '@/lib/race-live/server';

export const dynamic = 'force-dynamic';

// The fallback that always works: staff type a split off the official app.
// POST { athleteId, point, time: "1:28:30" } → stored as source 'manual' and announced through
// the same claim path as the feed, so the two can never double-push.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const sec = body.point === 'start' ? 0 : parseClock(body.time);
  if (!body.athleteId || !isPointKey(body.point) || sec === null) {
    return NextResponse.json({ error: 'athleteId, point and time (H:MM:SS) required' }, { status: 400 });
  }
  try {
    const db = createServerClient();
    const { data: cfg } = await db.from('race_live_config').select('*').eq('event_id', eventId).maybeSingle();
    const splits = [{ point: 'start' as const, elapsedSec: 0 }, { point: body.point, elapsedSec: sec }];
    const changed = await storeSplits(db, eventId, new Map([[String(body.athleteId), splits]]), 'manual');
    const pushed = cfg ? await announceMilestones(db, cfg as RaceConfig, changed) : 0;
    // An official time over a watch finish: the milestone is already claimed, so refresh the card here.
    if (body.point === 'finish' && changed.length) await postFinisherCard(db, eventId, String(body.athleteId), splits);
    return NextResponse.json({ ok: true, pushed });
  } catch (error: any) {
    console.error('[api/race-live/[eventId]/manual]', error);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}
