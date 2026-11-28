import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { mergePhonePosition, parsePhonePosition, phoneWriteAllowed } from '@/lib/race-live/phone';

export const dynamic = 'force-dynamic';

/**
 * POST { lat, lon, distanceM, elapsedSec, at } — the caller's OWN phone position during the race (b24).
 * DELETE — stop sharing: the caller's position row goes at once.
 *
 * Identity is the JWT's (resolveVerifiedCaller); there is no athleteId in the body and no way to write
 * anyone else's row — not even as staff. Needs `race_live_phone` on for the caller, an active race window,
 * and a race_entries row that is not opted out. Stores ONE latest row (race_positions), the same row and
 * the same visibility/retention as LiveTrack positions (docs/race-live.md, "Phone location").
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 403 });
  const db = createServerClient();
  if (!(await isFeatureEnabled('race_live_phone', caller.athleteId, db))) return NextResponse.json({ error: 'off' }, { status: 403 });
  const nowMs = Date.now();
  const next = parsePhonePosition(await request.json().catch(() => null), nowMs);
  if (!next) return NextResponse.json({ error: 'bad-body' }, { status: 400 });
  const [{ data: cfg }, { data: entry }, { data: prev }] = await Promise.all([
    db.from('race_live_config').select('active, poll_from, poll_to').eq('event_id', eventId).maybeSingle(),
    db.from('race_entries').select('live_opt_out').eq('event_id', eventId).eq('athlete_id', caller.athleteId).maybeSingle(),
    db.from('race_positions').select('distance_m, elapsed_sec, at').eq('event_id', eventId).eq('athlete_id', caller.athleteId).maybeSingle(),
  ]);
  const reject = phoneWriteAllowed({ nowMs, cfg: cfg ?? null, entry: entry ?? null, prev: prev ?? null, next });
  if (reject) {
    const status = reject === 'too-soon' ? 429 : reject === 'out-of-window' ? 409 : 403;
    return NextResponse.json({ error: reject }, { status });
  }
  const row = mergePhonePosition(prev ?? null, next);
  const { error } = await db.from('race_positions').upsert({
    event_id: eventId, athlete_id: caller.athleteId, lat: next.lat, lon: next.lon,
    distance_m: row.distance_m, elapsed_sec: row.elapsed_sec, at: next.at,
  }, { onConflict: 'event_id,athlete_id' });
  if (error) return NextResponse.json({ error: 'save failed', details: error.message }, { status: 500 });
  // On a resumed session the phone adds these to its own counters from now on.
  return NextResponse.json(row.baseDistanceM
    ? { ok: true, resumed: true, distanceM: row.distance_m, baseDistanceM: row.baseDistanceM, baseElapsedSec: row.baseElapsedSec }
    : { ok: true, distanceM: row.distance_m });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 403 });
  const { error } = await createServerClient().from('race_positions').delete().eq('event_id', eventId).eq('athlete_id', caller.athleteId);
  if (error) return NextResponse.json({ error: 'delete failed', details: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
