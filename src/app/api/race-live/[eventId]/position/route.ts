import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isFeatureEnabled } from '@/lib/features/server';
import { parsePhonePosition, phoneWriteAllowed } from '@/lib/race-live/phone';
import { entriesWithSharing, writePosition } from '@/lib/race-live/server';
import { isMissingColumn } from '@/lib/supabase/schema-drift';

export const dynamic = 'force-dynamic';

/**
 * POST { lat, lon, distanceM, elapsedSec, at } — the caller's OWN phone position during the race (b24).
 * DELETE — stop sharing: the caller's position row goes at once, and the stop is stored on their
 *   race_entries row (sharing_stopped_at, 222) so the LiveTrack poller does not write it back (Q26-5).
 * POST { …, resume: true } is the only thing that lifts that stop; a plain POST after a stop is 403.
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
  if (!(await isFeatureEnabled('race_live_phone', caller.athleteId, db).catch(() => false))) return NextResponse.json({ error: 'off' }, { status: 403 });
  const nowMs = Date.now();
  const body = await request.json().catch(() => null);
  const next = parsePhonePosition(body, nowMs);
  const resume = (body as { resume?: unknown } | null)?.resume === true;
  if (!next) return NextResponse.json({ error: 'bad-body' }, { status: 400 });
  const [{ data: cfg }, entries, prev] = await Promise.all([
    db.from('race_live_config').select('active, poll_from, poll_to').eq('event_id', eventId).maybeSingle(),
    entriesWithSharing(db, eventId, 'live_opt_out', caller.athleteId),
    readPrev(db, eventId, caller.athleteId),
  ]);
  const entry = entries[0] ?? null;
  const reject = phoneWriteAllowed({ nowMs, cfg: cfg ?? null, entry, prev, next, resume });
  if (reject) {
    const status = reject === 'too-soon' ? 429 : reject === 'out-of-window' ? 409 : 403;
    return NextResponse.json({ error: reject }, { status });
  }
  if (resume && entry?.sharing_stopped_at) {
    await db.from('race_entries').update({ sharing_stopped_at: null }).eq('event_id', eventId).eq('athlete_id', caller.athleteId);
  }
  // Monotonic clamp only against the phone's own previous point (the watch's may be further along).
  const phonePrev = prev && prev.source !== 'livetrack' ? prev : null;
  const { error } = await writePosition(db, {
    event_id: eventId, athlete_id: caller.athleteId, lat: next.lat, lon: next.lon,
    distance_m: Math.max(next.distanceM, phonePrev?.distance_m ?? 0), elapsed_sec: next.elapsedSec, at: next.at,
    source: 'phone',
  });
  if (error) {
    console.error('race-live position save', error);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ error: 'no athlete' }, { status: 403 });
  const db = createServerClient();
  // The stop first, so a poll racing this request cannot re-create the row after the delete.
  const stop = await db.from('race_entries').update({ sharing_stopped_at: new Date().toISOString() })
    .eq('event_id', eventId).eq('athlete_id', caller.athleteId);
  if (stop.error && !isMissingColumn(stop.error, 'sharing_stopped_at')) {
    console.error('race-live stop sharing', stop.error);
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
  const { error } = await db.from('race_positions').delete().eq('event_id', eventId).eq('athlete_id', caller.athleteId);
  if (error) {
    console.error('race-live position delete', error);
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
  // durable: false = 222 not pasted yet, so the next LiveTrack poll may write the row back.
  return NextResponse.json({ ok: true, durable: !stop.error });
}

/** The caller's current row, with its writer (222); pre-migration without `source`. */
async function readPrev(db: ReturnType<typeof createServerClient>, eventId: string, athleteId: string): Promise<{ distance_m: number; at: string; source?: string | null } | null> {
  const q = (cols: string) => db.from('race_positions').select(cols).eq('event_id', eventId).eq('athlete_id', athleteId).maybeSingle();
  const first = await q('distance_m, at, source');
  if (!first.error) return (first.data as any) ?? null;
  if (!isMissingColumn(first.error, 'source')) return null;
  return ((await q('distance_m, at')).data as any) ?? null;
}
