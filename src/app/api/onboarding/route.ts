import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { computeSetupState } from '@/lib/onboarding/setup-tasks';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET  /api/onboarding — "is this person still new, and what's missing?"
// POST /api/onboarding — mark the tour seen / mark setup acknowledged
//
// No `?id=` parameter on purpose. This is self-only, keyed off the verified
// Supabase session, so there is nothing to point at somebody else — the
// projection carries phone/birth-date presence and would otherwise be a
// completeness oracle over the whole club.
//
// Never returns garmin_auth/strava_auth themselves, only whether they're set.
// ═════════════════════════════════════════════════════════════════════════════

// The two columns from migration 078. Selected separately from the rest because
// this route has to keep working on an environment where 078 hasn't been pasted
// in yet (migrations here are applied by hand) — same "not migrated yet"
// tolerance as /api/athletes/me and /api/athletes/notification-prefs.
const BASE_COLUMNS =
  'id, garmin_auth, strava_auth, data_source, avatar_url, phone, birth_date, gender, shirt_size, shoe_size, group_id, active_shoe_id';
const FULL_COLUMNS = `${BASE_COLUMNS}, onboarding_tour_seen_at, onboarding_completed_at`;

/** '42703' = Postgres undefined_column; 'PGRST204' = PostgREST's schema cache. */
function isMissingColumn(code?: string) {
  return code === '42703' || code === 'PGRST204';
}

export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    // Staff that live only in the legacy `coaches` table have no athlete row to
    // score. Nothing to onboard, and nothing to nag them about.
    if (!auth.user.athleteId) {
      return NextResponse.json({ applicable: false });
    }

    const supabase = createServerClient();

    let migrated = true;
    let { data: row, error } = await supabase
      .from('athletes')
      .select(FULL_COLUMNS)
      .eq('id', auth.user.athleteId)
      .single();

    if (isMissingColumn(error?.code)) {
      migrated = false;
      ({ data: row, error } = await supabase
        .from('athletes')
        .select(BASE_COLUMNS)
        .eq('id', auth.user.athleteId)
        .single());
    }

    if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const athlete = row as Record<string, unknown>;

    // head:true + count → the server counts, no rows come back over the wire.
    const { count: pushCount } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('athlete_id', auth.user.athleteId);

    // Separate read rather than a nested select: the FK alias for groups differs
    // between environments here, and a bad embed fails the whole request.
    let groupName: string | null = null;
    if (athlete.group_id) {
      const { data: group } = await supabase
        .from('groups')
        .select('name')
        .eq('id', athlete.group_id as string)
        .maybeSingle();
      groupName = group?.name || null;
    }

    const state = computeSetupState({
      hasGarminAuth: !!athlete.garmin_auth,
      hasStravaAuth: !!athlete.strava_auth,
      dataSource: (athlete.data_source as string) || null,
      avatarUrl: (athlete.avatar_url as string) || null,
      phone: (athlete.phone as string) || null,
      birthDate: (athlete.birth_date as string) || null,
      gender: (athlete.gender as string) || null,
      shirtSize: (athlete.shirt_size as string) || null,
      shoeSize: (athlete.shoe_size as string) || null,
      pushSubscriptions: pushCount ?? 0,
      groupName,
      hasActiveShoe: !!athlete.active_shoe_id,
    });

    // Before 078 lands: nobody has been marked, so everyone reads as new and the
    // tour would replay on every open. Reporting tourSeen: true in that window
    // is the safer wrong answer — a tour that never runs beats one that can't be
    // dismissed. The card still shows, because it's derived and always correct.
    const tourSeenAt = migrated ? ((athlete.onboarding_tour_seen_at as string) || null) : null;
    const completedAt = migrated ? ((athlete.onboarding_completed_at as string) || null) : null;

    return NextResponse.json({
      applicable: true,
      migrated,
      tourSeen: migrated ? !!tourSeenAt : true,
      tourSeenAt,
      completed: !!completedAt,
      completedAt,
      ...state,
    });
  } catch (err) {
    console.error('Failed to resolve onboarding state:', err);
    return NextResponse.json({ error: 'Failed to resolve onboarding state' }, { status: 500 });
  }
}

// POST { markTourSeen?: boolean, markCompleted?: boolean }
//
// Both are one-way and idempotent: the columns are only ever stamped, never
// cleared. Replaying the tour or bringing the card back is a deliberate reset,
// which is a SQL statement an admin runs (see the RESET block at the foot of
// migration 078) — not something a client request can ask for, or a stray
// double-tap could undo.
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);
    if (!auth.user.athleteId) {
      return NextResponse.json({ error: 'This account has no athlete profile' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { markTourSeen, markCompleted } = body as { markTourSeen?: boolean; markCompleted?: boolean };
    if (!markTourSeen && !markCompleted) {
      return NextResponse.json({ error: 'Nothing to mark' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const updates: Record<string, string> = {};
    if (markTourSeen) updates.onboarding_tour_seen_at = now;
    if (markCompleted) updates.onboarding_completed_at = now;

    const supabase = createServerClient();
    const { error } = await supabase.from('athletes').update(updates).eq('id', auth.user.athleteId);

    if (isMissingColumn(error?.code)) {
      // 501, not 500: the request was fine, the column isn't there yet. The
      // client treats this as "couldn't remember that" and moves on rather than
      // showing an error — see FirstRunTour's dismiss handler.
      return NextResponse.json(
        { error: 'Onboarding columns not migrated yet (run supabase/migrations/078_onboarding_state.sql)' },
        { status: 501 },
      );
    }
    if (error) throw error;

    return NextResponse.json({ ok: true, ...updates });
  } catch (err) {
    console.error('Failed to save onboarding state:', err);
    return NextResponse.json({ error: 'Failed to save onboarding state' }, { status: 500 });
  }
}
