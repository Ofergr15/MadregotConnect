import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { COACH_ID } from '@/lib/constants';
import { getDisplayWeekStart } from '@/lib/plans/workout-parsing';
import { normalizeWorkoutParts } from '@/lib/plans/normalize-plan';
import { withGroupPaces } from '@/lib/plans/watch-paces';
import { paceGroupKeyFor } from '@/lib/plans/pace-group';
import { loadOwnWeek, providerFor, pushOwnWeek } from '@/lib/watch/own-week';
import { missingForAthletes } from '@/lib/watch/missing';
import { israelToday } from '@/lib/utils';
import { appleCandidates, deliverWeek, resolveWatchProvider, type WatchProvider } from '@/lib/watch';
import type { ParsedWorkout } from '@/lib/ai/types';
import { watchDays, type WatchDay } from '@/lib/watch/day-status';

/**
 * "Is this week's training actually on my watch?" — and, if it isn't, the one tap
 * that puts it there.
 *
 * ── Why this exists (bc77a4a2 + c1334a75) ────────────────────────────────────
 *
 * Every piece of this was already built and none of it was visible to the person
 * it is about. `workout_deliveries` has recorded, per athlete per date, whether
 * Garmin confirmed the workout — since the delivery code learned to refuse to say
 * "success" on anything less than a read-back off the account. But that table was
 * read only by coach and admin screens. The athlete, who is the one standing at
 * the start of a session with a watch that may or may not know what to do, had no
 * way to find out except by looking at the watch.
 *
 * ⚠️ SCOPE. This is the one route in the app that lets a non-staff caller cause a
 * write to a Garmin account, so the rule is absolute: **the athlete id comes from
 * the session and from nowhere else.** There is no id in the body, no id in the
 * query string, nothing to forge. `requireAthlete` also insists on an active club
 * member, so a session with no athlete row cannot reach the Garmin client at all.
 * A caller can therefore only ever act on themselves, which is why adding this
 * does not widen the service-role surface the rest of the API already runs on.
 *
 *   GET  → what the card shows: is Garmin connected, which of this week's dates
 *          Garmin has confirmed, and whether there's a plan at all.
 *   POST → push this week onto the caller's own account, then answer with the
 *          same shape GET does, so the card can redraw from one response.
 */

export const dynamic = 'force-dynamic';
// Two serial Garmin calls per workout plus a read-back. One athlete's week is a
// fraction of what the coach's whole-group push needs, but not a fraction of 15s.
export const maxDuration = 120;

interface WatchState {
  /** No Garmin account linked — a Strava-only athlete has no watch to put this on. */
  garminConnected: boolean;
  /** The plan week the answer is about, the same one the dashboard is displaying. */
  weekStartDate: string;
  hasPlan: boolean;
  /** Dates (YYYY-MM-DD) Garmin has CONFIRMED. 'pending' is deliberately not here. */
  onWatch: string[];
  /**
   * Per confirmed date: when it was last sent, whether a later send replaced an
   * earlier one, and whether a run came in stamped with it (lib/watch/day-status).
   * `onWatch` above stays for older bundles.
   */
  days: Record<string, WatchDay>;
  /**
   * Where this athlete's workouts go (lib/watch). 'apple' only for an athlete with
   * no Garmin link and a registered iPhone app; additive, nothing renders it yet.
   */
  provider: WatchProvider;
}

/**
 * The truthful read. `status: 'success'` only, because that is the only value
 * written after a workout was read back off the athlete's account — a 'pending'
 * row means a push started and we never confirmed it, and telling somebody their
 * session is on their watch when it might not be is the failure this whole
 * feature exists to prevent.
 */
async function readWatchState(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  weekStartDate: string,
  hasPlan: boolean,
  garminConnected: boolean,
  provider: WatchProvider = 'garmin',
): Promise<WatchState> {
  const data = await readDeliveries(supabase, athleteId, weekStartDate);
  return watchState(data, weekStartDate, hasPlan, garminConnected, provider);
}

type DeliveryRow = { workout_date: string; created_at: string; device_confirmed_at: string | null };

/** The week's confirmed deliveries: needs only who and which week, so GET asks it alongside the rest. */
async function readDeliveries(
  supabase: ReturnType<typeof createServerClient>,
  athleteId: string,
  weekStartDate: string,
): Promise<DeliveryRow[]> {
  const weekEnd = new Date(weekStartDate);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { data } = await supabase
    .from('workout_deliveries')
    .select('workout_date, created_at, device_confirmed_at')
    .eq('athlete_id', athleteId)
    .eq('status', 'success')
    .gte('workout_date', weekStartDate)
    .lte('workout_date', weekEndStr);
  return (data || []) as DeliveryRow[];
}

function watchState(
  data: DeliveryRow[],
  weekStartDate: string,
  hasPlan: boolean,
  garminConnected: boolean,
  provider: WatchProvider,
): WatchState {
  return {
    garminConnected,
    weekStartDate,
    hasPlan,
    onWatch: [...new Set((data || []).map((r: { workout_date: string }) => r.workout_date))].sort(),
    days: watchDays(data || []),
    provider,
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);

    // The deliveries need only who and which week, so they are read alongside the
    // row and the plan; the provider needs the row, so it comes after.
    const weekStartDate = getDisplayWeekStart(new Date());
    const [{ supabase, athlete, plan }, deliveries] = await Promise.all([
      loadOwnWeek(auth.user.athleteId, weekStartDate),
      readDeliveries(createServerClient(), auth.user.athleteId, weekStartDate),
    ]);
    const provider = await providerFor(supabase, athlete);
    // What the club sent them this week that is not on the watch (lib/watch/missing.ts) —
    // the feed's "השבוע בשעון" card. Apple has its own queue, so only Garmin is judged.
    const missing = athlete && provider !== 'apple'
      ? (await missingForAthletes([athlete], weekStartDate, israelToday(), supabase)).get(athlete.id) ?? null
      : null;

    return NextResponse.json({
      ...watchState(
        deliveries,
        weekStartDate,
        // A week with only one-day sessions has something on the watch too.
        !!plan || (missing?.expected.length ?? 0) > 0,
        // Never the token itself, not even a truncation of it — the credential is
        // encrypted at rest and a boolean is the whole of what a client needs.
        !!athlete?.garmin_auth,
        provider,
      ),
      missing,
    });
  } catch (error) {
    console.error('my-watch read error:', error);
    return NextResponse.json({ error: 'Failed to read watch status' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);

    // The push itself is lib/watch/own-week.ts — a reconnect calls the same function.
    const result = await pushOwnWeek(auth.user.athleteId);
    if (result.status === 'failed') return NextResponse.json({ error: result.error }, { status: 502 });
    if (result.status !== 'ok') return NextResponse.json({ error: result.status }, { status: 409 });
    const { supabase, weekStartDate, athlete } = await loadOwnWeek(auth.user.athleteId, result.weekStartDate);
    const provider = result.provider;

    // The fresh truth, read back rather than assumed, so the card redraws from
    // what `workout_deliveries` actually says after the push.
    return NextResponse.json(
      await readWatchState(supabase, auth.user.athleteId, weekStartDate, true, !!athlete?.garmin_auth, provider),
    );
  } catch (error: any) {
    console.error('my-watch push error:', error);
    return NextResponse.json({ error: error.message || 'Failed to push to watch' }, { status: 500 });
  }
}
