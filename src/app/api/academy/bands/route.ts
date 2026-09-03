import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { isValidPaceOffset, MAX_PACE_OFFSET_SEC, MIN_PACE_OFFSET_SEC } from '@/lib/academy/bands';
import {
  isAcademyManager, pairLookupError, requireAcademyManager, requireTraineeAccess,
} from '@/lib/academy/pairing-server';

export const dynamic = 'force-dynamic';

// The academy's two pace writes.
//
// A trainee's paces resolve in two tiers — their goal band (דבוקה) supplies the
// offset, and the trainee may be overridden individually — so there are exactly
// two things to write, and they belong to different people:
//
//   PUT   — this trainee's band and/or their own override.
//   PATCH — this band's offset, which moves everyone in it at once.
//
// Both matter more than they look: the offset is what the planner applies when it
// re-paces a workout before pushing it to a watch. Getting it wrong sends a
// beginner a sub-3 session, which is why an unset offset stays unset rather than
// defaulting to zero, and why every number here is validated server-side even
// though the pickers can only produce valid ones.

/** Sanity bound on a band's own offset — the same range a trainee's override allows. */
function badOffset(): Response {
  return NextResponse.json(
    { error: `offsetSeconds must be a whole number between ${MIN_PACE_OFFSET_SEC} and ${MAX_PACE_OFFSET_SEC}, or null` },
    { status: 400 },
  );
}

/**
 * PUT /api/academy/bands — set a trainee's goal band and/or their pace override.
 *
 * Body: `{ athleteId, bandId?: string | null, paceOffsetSec?: number | null }`.
 * Omitted fields are left alone; an explicit `null` clears.
 *
 * The permission split is the same one the pairing slice draws elsewhere, one
 * axis over: the BAND is an enrolment decision — it's what the trainee asked for
 * at registration and what the academy agreed to — so only a manager sets it. The
 * OVERRIDE is a coaching decision about what this person can actually run today,
 * so the trainee's own dedicated coach may set it too.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const athleteId = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }

    // `null` means "clear it" and an absent key means "don't touch it", so the two
    // have to stay distinguishable all the way to the update object.
    const hasBand = Object.prototype.hasOwnProperty.call(body, 'bandId');
    const hasOffset = Object.prototype.hasOwnProperty.call(body, 'paceOffsetSec');
    if (!hasBand && !hasOffset) {
      return NextResponse.json(
        { error: 'Pass bandId and/or paceOffsetSec; null clears either' },
        { status: 400 },
      );
    }

    const rawBand = body.bandId;
    const bandId: string | null = rawBand === null || rawBand === '' ? null
      : typeof rawBand === 'string' ? rawBand.trim()
        : '';
    if (hasBand && bandId === '') {
      return NextResponse.json({ error: 'bandId must be a band id or null' }, { status: 400 });
    }

    const rawOffset = body.paceOffsetSec;
    const paceOffsetSec: number | null = rawOffset === null ? null : rawOffset;
    if (hasOffset && paceOffsetSec !== null && !isValidPaceOffset(paceOffsetSec)) {
      return NextResponse.json(
        { error: `paceOffsetSec must be a whole number between ${MIN_PACE_OFFSET_SEC} and ${MAX_PACE_OFFSET_SEC}, or null` },
        { status: 400 },
      );
    }

    const { denied, caller, pair } = await requireTraineeAccess(request, athleteId);
    if (denied) return denied;
    if (!pair) return pairLookupError('not_found');
    if (!pair.isAcademy) {
      return NextResponse.json(
        { error: 'That athlete is not in the academy — add them to it first' },
        { status: 409 },
      );
    }
    if (hasBand && !isAcademyManager(caller)) {
      return NextResponse.json(
        { error: 'Only an academy manager can change a trainee\'s band' },
        { status: 403 },
      );
    }

    const supabase = createServerClient();

    // The band must exist. Checked rather than trusted from the picker, which is
    // built from the same list but isn't the only way in here.
    let bandName: string | null = null;
    if (hasBand && bandId) {
      const { data: band, error } = await supabase
        .from('academy_bands')
        .select('id, name')
        .eq('id', bandId)
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: 'Academy bands are not available yet — migration 077 has not been applied.' },
          { status: 409 },
        );
      }
      if (!band) return NextResponse.json({ error: 'No such band' }, { status: 404 });
      bandName = band.name;
    }

    const update: Record<string, unknown> = {};
    if (hasBand && bandId !== pair.academyBandId) update.academy_band_id = bandId;
    if (hasOffset && paceOffsetSec !== pair.academyPaceOffsetSec) {
      update.academy_pace_offset_sec = paceOffsetSec;
    }

    if (Object.keys(update).length === 0) {
      // Re-picking what they already have is a no-op, not an error.
      return NextResponse.json({
        athleteId,
        bandId: pair.academyBandId,
        bandName,
        paceOffsetSec: pair.academyPaceOffsetSec,
        unchanged: true,
      });
    }

    const { error: writeErr } = await supabase
      .from('athletes')
      .update(update)
      .eq('id', athleteId)
      .eq('coach_id', COACH_ID);
    if (writeErr) {
      console.error('Academy band assign error:', writeErr);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }

    return NextResponse.json({
      athleteId,
      bandId: hasBand ? bandId : pair.academyBandId,
      bandName,
      paceOffsetSec: hasOffset ? paceOffsetSec : pair.academyPaceOffsetSec,
      unchanged: false,
    });
  } catch (error: any) {
    console.error('Academy band assign error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save' }, { status: 500 });
  }
}

/**
 * PATCH /api/academy/bands — set a band's own pace offset, in sec/km.
 *
 * Body: `{ bandId, offsetSeconds: number | null }`. Null removes the key, which
 * puts the band back to "paces not set yet" — deliberately reachable, because a
 * wrong offset silently mis-paces everyone in the band and the honest state is
 * better than a stale guess.
 *
 * Manager-only: this moves every trainee in the band at once, which is exactly
 * the reason it isn't a per-trainee edit. Migration 077 seeds the six bands with
 * no offset at all, so this endpoint is how they get their first real value.
 */
export async function PATCH(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const bandId = typeof body.bandId === 'string' ? body.bandId.trim() : '';
    if (!bandId) return NextResponse.json({ error: 'bandId is required' }, { status: 400 });
    if (!Object.prototype.hasOwnProperty.call(body, 'offsetSeconds')) {
      return NextResponse.json({ error: 'offsetSeconds is required; pass null to unset' }, { status: 400 });
    }
    const offsetSeconds: number | null = body.offsetSeconds === null ? null : body.offsetSeconds;
    if (offsetSeconds !== null && !isValidPaceOffset(offsetSeconds)) return badOffset();

    const supabase = createServerClient();
    const { data: band, error } = await supabase
      .from('academy_bands')
      .select('id, name, pace_profile')
      .eq('id', bandId)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: 'Academy bands are not available yet — migration 077 has not been applied.' },
        { status: 409 },
      );
    }
    if (!band) return NextResponse.json({ error: 'No such band' }, { status: 404 });

    // Merged, not replaced: `marathonGoal` is the band's own description of what
    // it trains for and nothing here has any business dropping it. Tolerates a
    // non-object profile, since this is JSONB nobody validated on the way in.
    const raw = band.pace_profile;
    const profile: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
    if (offsetSeconds === null) delete profile.offsetSeconds;
    else profile.offsetSeconds = offsetSeconds;

    const { error: writeErr } = await supabase
      .from('academy_bands')
      .update({ pace_profile: profile, updated_at: new Date().toISOString() })
      .eq('id', bandId);
    if (writeErr) {
      console.error('Academy band pace update error:', writeErr);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }

    return NextResponse.json({ bandId, name: band.name, offsetSeconds });
  } catch (error: any) {
    console.error('Academy band pace update error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save' }, { status: 500 });
  }
}
