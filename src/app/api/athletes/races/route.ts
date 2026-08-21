import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { isSuperUser } from '@/lib/constants';
import { recomputeRaceMatches } from '@/lib/races/match-athlete-races';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';

export const dynamic = 'force-dynamic';

// GET /api/athletes/races?athleteId=…
// Race-count analytic (roadmap #20): recomputes auto race matches (same-day
// against `events` where kind='race') then returns every activity currently
// flagged as a race for this athlete, newest first, plus the total count.
// Authorization mirrors /api/athletes/prs: a caller may fetch their own
// races; verified staff (coach/admin/academy_coach via x-user-email) may
// fetch any athlete's.
async function authorize(
  supabase: ReturnType<typeof createServerClient>,
  request: Request,
  athleteId: string,
): Promise<boolean> {
  const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
  if (isSuperUser(email)) return true; // consistent w/ view-as
  if (!email) return false;
  const { data: caller } = await supabase
    .from('athletes')
    .select('id, role')
    .eq('email', email)
    .maybeSingle();
  const isStaff = !!caller && ['coach', 'admin', 'academy_coach'].includes((caller as any).role);
  return isStaff || (caller as any)?.id === athleteId;
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get('athleteId');
    if (!athleteId) {
      return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
    }

    if (!(await authorize(supabase, request, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    try {
      const { matched } = await recomputeRaceMatches(supabase, athleteId);
      // A newly auto-matched race can complete a race_count badge (e.g.
      // "First Race"). Only bother checking when something actually changed
      // this call — never let a badge-check failure break the races read.
      if (matched > 0) {
        try {
          await checkAndAwardBadges(athleteId);
        } catch { /* badge check is best-effort */ }
      }
    } catch (matchError) {
      // Migration 058 may not be applied yet (hand-pasted convention) — race
      // count is an optional add-on, so degrade to "no races" instead of
      // failing the whole request.
      console.warn(`Race matching for ${athleteId} skipped:`, matchError);
      return NextResponse.json({ races: [], totalRaces: 0 });
    }

    const { data, error } = await supabase
      .from('race_matches')
      .select(
        'id, activity_id, event_id, match_method, evidence, is_race, athlete_activities(activity_name, start_time, distance, duration), events(name, date, location, race_class, distances)',
      )
      .eq('athlete_id', athleteId)
      .eq('is_race', true);
    if (error) throw error;

    const races = (data || [])
      .map((row: any) => ({
        id: row.id,
        activityId: row.activity_id,
        eventId: row.event_id,
        matchMethod: row.match_method,
        activityName: row.athlete_activities?.activity_name ?? null,
        date: row.events?.date ?? row.athlete_activities?.start_time ?? null,
        distance: row.athlete_activities?.distance ?? null,
        duration: row.athlete_activities?.duration ?? null,
        eventName: row.events?.name ?? null,
        location: row.events?.location ?? null,
        raceClass: row.events?.race_class ?? null,
      }))
      .sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0));

    return NextResponse.json({ races, totalRaces: races.length });
  } catch (err: any) {
    console.error('Races error:', err);
    return NextResponse.json({ error: err.message || 'Failed to compute races' }, { status: 500 });
  }
}

// PATCH /api/athletes/races  { athleteId, activityId, isRace, eventId? }
// Manual tagging/correction on top of the auto match: mark an activity as a
// race that the auto (same-day) pass missed, re-point it to a different
// event, or correct a wrong auto-match by setting isRace:false (a tombstone —
// kept as a row, not deleted, so recomputeRaceMatches never re-adds it).
export async function PATCH(request: Request) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    const { athleteId, activityId, isRace, eventId } = body || {};
    if (!athleteId || !activityId || typeof isRace !== 'boolean') {
      return NextResponse.json(
        { error: 'athleteId, activityId, and isRace (boolean) required' },
        { status: 400 },
      );
    }

    if (!(await authorize(supabase, request, athleteId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { data: activity, error: activityError } = await supabase
      .from('athlete_activities')
      .select('id, athlete_id')
      .eq('id', activityId)
      .maybeSingle();
    if (activityError) throw activityError;
    if (!activity || activity.athlete_id !== athleteId) {
      return NextResponse.json({ error: 'Activity not found for this athlete' }, { status: 404 });
    }

    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    const { data: match, error } = await supabase
      .from('race_matches')
      .upsert(
        {
          activity_id: activityId,
          athlete_id: athleteId,
          event_id: eventId || null,
          is_race: isRace,
          match_method: 'manual',
          evidence: { reason: 'manual_override' },
          overridden_by: email || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'activity_id' },
      )
      .select('*')
      .single();
    if (error) throw error;

    // A manual "yes this was a race" confirmation can complete a race_count
    // badge just like an auto match — never let a badge-check failure break
    // the tagging itself.
    if (isRace) {
      try {
        await checkAndAwardBadges(athleteId);
      } catch { /* badge check is best-effort */ }
    }

    return NextResponse.json({ match });
  } catch (err: any) {
    console.error('Race match update error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update race match' }, { status: 500 });
  }
}
