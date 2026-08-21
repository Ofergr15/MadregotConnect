import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/athletes/activities/manual
 *
 * Fallback activity entry for athletes with neither Strava nor Garmin
 * connected (see `ConnectDataSourcePopup` / the Activities page "Log
 * Activity" button). Inserts a plain `athlete_activities` row with
 * `source: 'manual'` — no CHECK constraint restricts `source`'s values (only
 * 'garmin' / 'strava' have been used so far), so no migration is needed to
 * allow this.
 *
 * Body: { athleteId, date: 'YYYY-MM-DD', time?: 'HH:MM', distanceKm: number,
 *         durationSeconds: number, activityName?: string, activityType?: string }
 */

const ALLOWED_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      athleteId,
      date,
      time,
      distanceKm,
      durationSeconds,
      activityName,
      activityType,
    } = body || {};

    if (!athleteId || typeof athleteId !== 'string') {
      return NextResponse.json({ error: 'athleteId is required' }, { status: 400 });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
    }
    const distance = Number(distanceKm);
    if (!Number.isFinite(distance) || distance <= 0) {
      return NextResponse.json({ error: 'distanceKm must be a positive number' }, { status: 400 });
    }
    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: 'durationSeconds must be a positive number' }, { status: 400 });
    }

    const timeStr = /^\d{2}:\d{2}$/.test(time || '') ? time : '07:00';
    // No timezone suffix: athlete_activities.start_time holds "UTC-shaped"
    // local wall-clock (see CLAUDE.md) — the same convention Strava/Garmin
    // sync already use, so downstream helpers (formatActivityTime, weekly
    // rollups, etc.) read this row correctly without a double timezone shift.
    const startTime = `${date}T${timeStr}:00`;

    const distanceMeters = Math.round(distance * 1000);
    const durationSecRounded = Math.round(duration);
    const type = ALLOWED_TYPES.includes(activityType) ? activityType : 'running';

    // garmin_activity_id is NOT NULL + UNIQUE(athlete_id, garmin_activity_id).
    // There's no external id for a manual entry, so — mirroring the Strava
    // sentinel convention (garmin_activity_id = -strava_activity_id) — use a
    // negative, time+random-based sentinel that stays well outside both the
    // positive Garmin id space and Strava's (much smaller) negative range.
    const sentinelId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

    const supabase = createServerClient();
    const row = {
      athlete_id: athleteId,
      garmin_activity_id: sentinelId,
      source: 'manual',
      activity_name: (activityName || '').trim() || 'Manual Run',
      activity_type: type,
      start_time: startTime,
      distance: distanceMeters,
      duration: durationSecRounded,
      average_pace: distanceMeters > 0 ? Math.round(durationSecRounded / (distanceMeters / 1000)) : null,
    };

    const { data: inserted, error } = await supabase
      .from('athlete_activities')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save activity', details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ activity: { id: inserted.id, ...row } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save activity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
