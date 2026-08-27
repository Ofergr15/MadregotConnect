import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

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
    if (avatarUrl) {
      await supabase
        .from('athletes')
        .update({ avatar_url: avatarUrl })
        .eq('email', lowerEmail)
        .is('avatar_url', null);
    }

    // Check if user is a coach (must also exist in athletes with coach/admin role)
    const { data: coach } = await supabase
      .from('coaches')
      .select('id, email, name')
      .eq('email', lowerEmail)
      .single();

    if (coach) {
      const { data: coachAthlete } = await supabase
        .from('athletes')
        .select('id, role')
        .eq('email', lowerEmail)
        .in('role', ['coach', 'admin'])
        .maybeSingle();

      if (coachAthlete) {
        // Include the athletes row — run-chat / Stream identify staff by athletes.id.
        const { data: fullAthlete } = await supabase
          .from('athletes')
          .select('id, name, email, group_id')
          .eq('id', coachAthlete.id)
          .maybeSingle();
        return NextResponse.json({
          role: coachAthlete.role || 'coach',
          coach,
          athlete: fullAthlete || { id: coachAthlete.id, name: coach.name, email: lowerEmail, group_id: null },
        });
      }
      // Coach record exists but no matching athlete — treat as new user (was deleted)
    }

    // Check if user is an athlete. Use maybeSingle (not single) so a stray
    // duplicate row can't throw and wrongly force re-registration; if there are
    // multiple, prefer the most complete one (has Garmin, else most recent).
    const { data: activeRows } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth, strava_auth, approved, role, created_at')
      .eq('email', lowerEmail)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    // Prefer Strava-connected rows (primary source), then Garmin legacy.
    const athlete = (activeRows || []).sort(
      (a: any, b: any) =>
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
          athlete: { id: athlete.id, name: athlete.name, email: athlete.email, group_id: athlete.group_id },
        });
      }
      const hasGarmin = !!athlete.garmin_auth;
      const hasStrava = !!athlete.strava_auth;
      // Honor the athlete's actual role (coach / academy_coach / academy_user / …),
      // not a hardcoded 'runner', so elevated roles resolve correctly on login.
      return NextResponse.json({
        role: athlete.role || 'runner',
        athlete: {
          ...athlete,
          garmin_auth: undefined,
          strava_auth: undefined,
          approved: undefined,
          role: undefined,
        },
        hasGarmin,
        hasStrava,
      });
    }

    // Check invited athletes (need onboarding)
    const { data: invitedAthlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth, approved')
      .eq('email', lowerEmail)
      .eq('status', 'invited')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invitedAthlete) {
      const hasGarmin = !!invitedAthlete.garmin_auth;
      // Not yet approved → hold at pending, regardless of Garmin (approval owns
      // entry; Garmin/group are optional and can be added from inside the app).
      if (invitedAthlete.approved === false) {
        return NextResponse.json({
          pendingApproval: true,
          missingGarmin: !hasGarmin,
          athlete: { id: invitedAthlete.id, name: invitedAthlete.name, email: invitedAthlete.email, group_id: invitedAthlete.group_id },
        });
      }
      // Approved invited user → straight to the dashboard (no forced onboarding).
      return NextResponse.json({ role: 'runner', athlete: { ...invitedAthlete, garmin_auth: undefined, approved: undefined }, hasGarmin });
    }

    // Check if athlete exists with any status (could be missing garmin/group)
    const { data: anyAthlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth, approved, role')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (anyAthlete) {
      const hasGarmin = !!anyAthlete.garmin_auth;
      // An EXISTING athlete goes straight to the dashboard — Garmin and group are
      // both optional/deferrable now, so we don't force a returning user back
      // through onboarding just because one is missing. Onboarding is only for
      // brand-new users (handled below). Approval still gates entry.
      if (anyAthlete.approved === false) {
        return NextResponse.json({
          pendingApproval: true,
          athlete: { id: anyAthlete.id, name: anyAthlete.name, email: anyAthlete.email, group_id: anyAthlete.group_id },
        });
      }
      if (anyAthlete.status !== 'active') {
        await supabase.from('athletes').update({ status: 'active' }).eq('id', anyAthlete.id);
      }
      return NextResponse.json({
        role: anyAthlete.role || 'runner',
        athlete: { ...anyAthlete, garmin_auth: undefined, approved: undefined, role: undefined },
        hasGarmin,
      });
    }

    // Completely new user — create record and track onboarding
    // Get a default coach for the foreign key constraint
    const { data: defaultCoach } = await supabase
      .from('coaches')
      .select('id')
      .limit(1)
      .maybeSingle();

    const { data: newAthlete } = await supabase
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
      }, { onConflict: 'email', ignoreDuplicates: true })
      .select('id')
      .single();

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
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to resolve role' },
      { status: 500 }
    );
  }
}
