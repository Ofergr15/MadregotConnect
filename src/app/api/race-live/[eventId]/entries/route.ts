import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, mayActFor } from '@/lib/auth/self-or-staff';
import { normalizeBib } from '@/lib/race-live/core';
import { parseLiveTrackUrl, linkToUrl } from '@/lib/race-live/livetrack';
import { purgeLiveTrack } from '@/lib/race-live/server';

export const dynamic = 'force-dynamic';

// PUT { athleteId?, bib?, goalSec?, liveOptOut?, livetrackUrl? (null clears) } — the runner for their own row, or staff.
// Identity is the JWT's (mayActFor); athleteId defaults to the caller.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const athleteId = String(body.athleteId || caller.athleteId || '');
  if (!athleteId) return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  if (!mayActFor(caller, athleteId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const patch: Record<string, unknown> = { event_id: eventId, athlete_id: athleteId, updated_at: new Date().toISOString() };
  if ('bib' in body) patch.bib = normalizeBib(body.bib);
  if ('goalSec' in body) patch.goal_sec = body.goalSec === null ? null : Math.round(Number(body.goalSec)) || null;
  if ('liveOptOut' in body) patch.live_opt_out = !!body.liveOptOut;
  if ('livetrackUrl' in body) {
    if (body.livetrackUrl === null || body.livetrackUrl === '') {
      patch.livetrack_url = null; patch.livetrack_state = null;
    } else {
      const link = parseLiveTrackUrl(body.livetrackUrl);
      if (!link) return NextResponse.json({ error: 'not a livetrack.garmin.com link' }, { status: 400 });
      patch.livetrack_url = linkToUrl(link); // canonical, no query junk
      patch.livetrack_state = null; patch.livetrack_polled_at = null;
    }
  }
  const { error } = await createServerClient().from('race_entries').upsert(patch, { onConflict: 'event_id,athlete_id' });
  if (error) { console.error('[api/race-live/[eventId]/entries]', error); return NextResponse.json({ error: 'save failed' }, { status: error.code === '23505' ? 409 : 500 }); }
  // Opting out deletes the link and the last position at once — nothing to keep for a hidden runner.
  if (body.liveOptOut === true) await purgeLiveTrack(createServerClient(), eventId, athleteId);
  return NextResponse.json({ ok: true });
}
