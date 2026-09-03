import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

// Every athlete field any branch below needs, so the table is read once.
const ATHLETE_COLUMNS =
  'id, name, email, group_id, status, garmin_auth, strava_auth, approved, role, created_at';

interface AthleteRow {
  id: string;
  name: string | null;
  email: string;
  group_id: string | null;
  status: string | null;
  garmin_auth: unknown;
  strava_auth: unknown;
  approved: boolean | null;
  role: string | null;
  created_at: string;
}

/**
 * The athlete fields this route may hand back. Never spread a raw row into a
 * response: it carries garmin_auth and strava_auth, which are OAuth credentials.
 */
function publicProfile(row: AthleteRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    group_id: row.group_id,
    status: row.status,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { email, name, avatarUrl } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const lowerEmail = email.toLowerCase().trim();

    // Backfill the Google profile photo for any athlete row that doesn't have one
    // yet (a manual upload always wins because it's set explicitly elsewhere).
    // Nothing read below depends on it and it isn't in the response, so it rides
    // along with the reads instead of adding a round trip in front of them.
    const backfill = avatarUrl
      ? supabase
          .from('athletes')
          .update({ avatar_url: avatarUrl })
          .eq('email', lowerEmail)
          .is('avatar_url', null)
      : null;

    // One read serves every branch. This route used to query athletes for the same
    // email up to four times in sequence — coach/admin, then active, then invited,
    // then any status, plus a re-read of a row it had already found — and it runs on
    // the critical path of every sign-in, so each round trip was time the athlete
    // spent on a loading screen. The filtering is pure logic; do it here.
    const [coachRes, athleteRes] = await Promise.all([
      supabase.from('coaches').select('id, email, name').eq('email', lowerEmail).maybeSingle(),
      supabase
        .from('athletes')
        .select(ATHLETE_COLUMNS)
        .eq('email', lowerEmail)
        .order('created_at', { ascending: false }),
      backfill,
    ]);

    const coach = coachRes.data;
    // Newest first, so every `find` below picks the most recent matching row.
    // Duplicates must never throw here: the old code used maybeSingle(), which
    // errors on more than one row, and a stray duplicate then read as "no athlete"
    // and wrongly forced a returning user back through registration.
    const rows = (athleteRes.data || []) as unknown as AthleteRow[];

    // A coach is staff only if they also hold a coach/admin athletes row —
    // run-chat / Stream identify staff by athletes.id.
    if (coach) {
      const coachAthlete = rows.find(r => r.role === 'coach' || r.role === 'admin');
      if (coachAthlete) {
        return NextResponse.json({
          role: coachAthlete.role || 'coach',
          coach,
          athlete: {
            id: coachAthlete.id,
            name: coachAthlete.name || coach.name,
            email: coachAthlete.email || lowerEmail,
            group_id: coachAthlete.group_id,
          },
        });
      }
      // Coach record exists but no matching athlete — treat as new user (was deleted)
    }

    // Prefer Strava-connected rows (primary source), then Garmin legacy. Sort is
    // stable and the fetch is newest-first, so ties keep the most recent row.
    const athlete = rows
      .filter(r => r.status === 'active')
      .sort(
        (a, b) =>
          (b.strava_auth ? 2 : 0) + (b.garmin_auth ? 1 : 0) -
          ((a.strava_auth ? 2 : 0) + (a.garmin_auth ? 1 : 0)),
      )[0];

    if (athlete) {
      if (athlete.approved === false) {
        // Include `athlete` even though pending — the client sets athlete_id
        // from this BEFORE branching on pendingApproval specifically so the
        // /pending-approval push opt-in has a subscription target; without
        // it, a returning-but-still-unapproved user never gets offered
        // "notify me when approved" at all.
        return NextResponse.json({
          pendingApproval: true,
          missingGarmin: false,
          athlete: {
            id: athlete.id,
            name: athlete.name,
            email: athlete.email,
            group_id: athlete.group_id,
          },
        });
      }
      // Honor the athlete's actual role (coach / academy_coach / academy_user / …),
      // not a hardcoded 'runner', so elevated roles resolve correctly on login.
      return NextResponse.json({
        role: athlete.role || 'runner',
        athlete: { ...publicProfile(athlete), created_at: athlete.created_at },
        hasGarmin: !!athlete.garmin_auth,
        hasStrava: !!athlete.strava_auth,
      });
    }

    // Invited athletes (may need onboarding).
    const invitedAthlete = rows.find(r => r.status === 'invited');

    if (invitedAthlete) {
      const hasGarmin = !!invitedAthlete.garmin_auth;
      // Not yet approved → hold at pending, regardless of Garmin (approval owns
      // entry; Garmin/group are optional and can be added from inside the app).
      if (invitedAthlete.approved === false) {
        return NextResponse.json({
          pendingApproval: true,
          missingGarmin: !hasGarmin,
          athlete: {
            id: invitedAthlete.id,
            name: invitedAthlete.name,
            email: invitedAthlete.email,
            group_id: invitedAthlete.group_id,
          },
        });
      }
      // Approved invited user → straight to the dashboard (no forced onboarding).
      return NextResponse.json({
        role: 'runner',
        athlete: publicProfile(invitedAthlete),
        hasGarmin,
      });
    }

    // An athlete row with some other status (could be missing garmin/group).
    const anyAthlete = rows[0];

    if (anyAthlete) {
      const hasGarmin = !!anyAthlete.garmin_auth;
      // An EXISTING athlete goes straight to the dashboard — Garmin and group are
      // both optional/deferrable now, so we don't force a returning user back
      // through onboarding just because one is missing. Onboarding is only for
      // brand-new users (handled below). Approval still gates entry.
      if (anyAthlete.approved === false) {
        return NextResponse.json({
          pendingApproval: true,
          athlete: {
            id: anyAthlete.id,
            name: anyAthlete.name,
            email: anyAthlete.email,
            group_id: anyAthlete.group_id,
          },
        });
      }
      if (anyAthlete.status !== 'active') {
        await supabase.from('athletes').update({ status: 'active' }).eq('id', anyAthlete.id);
      }
      return NextResponse.json({
        role: anyAthlete.role || 'runner',
        athlete: publicProfile(anyAthlete),
        hasGarmin,
      });
    }

    // Completely new user — create record and track onboarding. Sequential on
    // purpose: the insert needs a coach for the foreign key. This is the
    // once-per-lifetime path, not the one every sign-in pays for.
    const { data: defaultCoach } = await supabase
      .from('coaches')
      .select('id')
      .limit(1)
      .maybeSingle();

    await supabase
      .from('athletes')
      .upsert({
        email: lowerEmail,
        name: name || lowerEmail.split('@')[0],
        status: 'invited',
        role: 'runner',
        onboarding_status: 'google_authed',
        google_authed_at: new Date().toISOString(),
        approved: false,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        ...(defaultCoach ? { coach_id: defaultCoach.id } : {}),
      }, { onConflict: 'email', ignoreDuplicates: true });

    // Email notification moved to /api/athletes/connect — fires only after
    // Garmin auth completes or user presses "I'll connect later"

    return NextResponse.json({
      role: 'runner',
      email: lowerEmail,
      name,
      needsOnboarding: true,
      missingGroup: true,
      missingGarmin: true,
      pendingApproval: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to resolve role' },
      { status: 500 }
    );
  }
}
