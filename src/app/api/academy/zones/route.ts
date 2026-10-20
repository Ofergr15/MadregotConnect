import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireTraineeAccess } from '@/lib/academy/pairing-server';
import { loadDecisions, loadTestBasis, recordDecision } from '@/lib/academy/coach-tools-server';
import { activeAdjust, cleanZones, lapsedZones, ZONES_ACTION } from '@/lib/academy/coach-tools';
import { loadTrainees } from '@/lib/academy/book-server';
import { resolveThreshold } from '@/lib/academy/day-send';
import { ZONE_INTENSITY, zoneCentrePace } from '@/lib/academy/library';
import { israelToday, planWeekStartOf } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The trainee's pace zones as the coach sees them (Ofer, 2026-10-20, mockups/coach-baseline):
 * every zone of ZONE_INTENSITY with its SUGGESTED pace — from the approved test, else the
 * coach's baseline, else the band — and the coach's manual pace where one is set.
 *
 *   GET ?athleteId=          → { basis, thresholdSec, zones: [{ zone, suggested, set }], lapsed }
 *   PUT { athleteId, zones } → the whole manual set (a zone left out = back to suggested)
 *
 * Stored as an academy_coach_decisions row (migration 141): kind 'pace', action 'zones',
 * changes { zones } in absolute sec/km, against the current basis's date. A new approved test is
 * a new basis, so the manual zones lapse with it and `lapsed` tells the coach once.
 *
 * WHO: `requireTraineeAccess` — the trainee's own coach or a manager; never the trainee.
 */
async function read(athleteId: string) {
  const db = createServerClient();
  const [basisMap, decided, trainees] = await Promise.all([
    loadTestBasis(db, [athleteId]),
    loadDecisions(db, [athleteId]),
    loadTrainees(db, [athleteId]),
  ]);
  const b = basisMap[athleteId];
  const priced = resolveThreshold(b?.thresholdSec, trainees[0]?.bandThresholdSec, b?.source);
  const basisDate = b?.testDate ?? null;
  const active = activeAdjust(decided.rows, basisDate);
  return { db, b, priced, basisDate, set: active.adjust.zones ?? {}, lapsed: lapsedZones(decided.rows, basisDate), stored: decided.stored };
}

export async function GET(request: Request) {
  const athleteId = new URL(request.url).searchParams.get('athleteId') || '';
  const { denied, caller } = await requireTraineeAccess(request, athleteId);
  if (denied) return denied;
  if (caller.athleteId === athleteId) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  try {
    const r = await read(athleteId);
    const thr = r.priced.sec;
    return NextResponse.json({
      basis: r.priced.basis,
      basisDate: r.basisDate,
      thresholdSec: thr,
      stored: r.stored,
      zones: Object.keys(ZONE_INTENSITY).map((zone) => ({
        zone,
        suggested: thr ? zoneCentrePace(thr, zone) : null,
        set: r.set[zone] ?? null,
      })),
      lapsed: r.lapsed,
    });
  } catch (err) {
    console.error('[academy/zones] read failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { athleteId?: unknown; zones?: unknown } | null;
  const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
  const { denied, caller } = await requireTraineeAccess(request, athleteId);
  if (denied) return denied;
  if (!athleteId || caller.athleteId === athleteId) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const zones = cleanZones(body?.zones);
  try {
    const r = await read(athleteId);
    if (!r.priced.sec || !r.basisDate) return NextResponse.json({ error: 'No paces to set yet' }, { status: 409 });
    const ok = await recordDecision(r.db, {
      athleteId,
      coachId: caller.athleteId ?? null,
      kind: 'pace',
      action: ZONES_ACTION,
      basisTestDate: r.basisDate,
      // From this plan week: sessions sent from now on carry the manual paces.
      weekStart: planWeekStartOf(israelToday()),
      changes: { zones },
    });
    if (!ok) return NextResponse.json({ error: 'Not set up' }, { status: 503 });
    return NextResponse.json({ ok: true, zones });
  } catch (err) {
    console.error('[academy/zones] save failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
