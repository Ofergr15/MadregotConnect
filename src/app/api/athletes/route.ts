import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID, isProtectedEmail } from '@/lib/constants';
import { groupDisplayName, israelToday } from '@/lib/utils';
import { syncClubFollows } from '@/lib/follows/club-sync';
import { authError, requireSession, type SessionUser } from '@/lib/auth-session';
import { athleteWriteError, denyAthleteWrite } from '@/lib/auth/athlete-write-scope';

const DEMO_COACH_ID = COACH_ID;

/**
 * Staff gate for creating and deleting athletes. GET stays open: the athletes,
 * academy, profile, photos and plan screens all read the roster, several of them
 * before a session has resolved.
 */
async function requireStaff(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return { denied: authError(auth), user: null };
  if (!auth.user.isStaff) {
    return {
      denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }),
      user: null,
    };
  }
  return { denied: null, user: auth.user as SessionUser };
}

// GET - List all athletes for the coach
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    let athletes: any[] | null = null;
    let error: any = null;

    const result = await supabase
      .from('athletes')
      .select(`
        id, name, email, status, created_at, garmin_auth, strava_auth, data_source, strava_enabled, onboarding_status, is_academy, group_id,
        groups (name)
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (result.error) {
      const fallback = await supabase
        .from('athletes')
        .select(`id, name, email, status, created_at, garmin_auth, group_id, groups (name)`)
        .eq('coach_id', coachId)
        .order('created_at', { ascending: false });
      athletes = fallback.data;
      error = fallback.error;
    } else {
      athletes = result.data;
      error = null;
    }

    if (error) throw error;

    // Transform data to include group name and last synced
    const transformedAthletes = athletes?.map(athlete => ({
      id: athlete.id,
      name: athlete.name,
      email: athlete.email,
      status: athlete.status,
      groupName: (athlete.groups as any)?.name ? groupDisplayName((athlete.groups as any).name) : null,
      groupId: athlete.group_id,
      group_id: athlete.group_id,
      dataSource: (athlete as any).data_source || 'garmin',
      isAcademy: !!(athlete as any).is_academy,
      hasGarmin: !!athlete.garmin_auth,
      hasStrava: !!(athlete as any).strava_auth,
      stravaEnabled: !!(athlete as any).strava_enabled,
      onboardingStatus: (athlete as any).onboarding_status || null,
      lastSynced: athlete.garmin_auth || (athlete as any).strava_auth ? new Date().toISOString() : null,
      createdAt: athlete.created_at,
    }));

    return NextResponse.json({ athletes: transformedAthletes || [] });
  } catch (error) {
    console.error('Failed to fetch athletes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch athletes' },
      { status: 500 }
    );
  }
}

// POST - Create a new athlete invitation
export async function POST(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const body = await request.json();
    const { name, email, publicLink, groupId } = body;

    // Public link mode — generate a reusable token without creating an athlete record
    if (publicLink) {
      const inviteToken = randomBytes(16).toString('hex');

      // Store as a placeholder athlete entry so the token is valid when someone joins
      const { error } = await supabase
        .from('athletes')
        .insert({
          coach_id: DEMO_COACH_ID,
          name: 'Public Invite',
          email: `public-${inviteToken}@invite.madregot.app`,
          status: 'invited',
          invite_token: inviteToken,
        });

      if (error) throw error;

      const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app'}/join/${inviteToken}`;
      return NextResponse.json({ inviteLink });
    }

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const inviteToken = randomBytes(16).toString('hex');

    // Create athlete record with invited status. Store email normalized
    // (lowercase+trim) so it always matches the Google sign-in email later —
    // otherwise the user is treated as new and asked to re-register.
    // A named coach invite IS the approval — the coach deliberately chose this
    // person — so pre-approve it. They go active as soon as they connect, with
    // no second approval click. Only self-registrants (public link / academy
    // form / new Google sign-in) stay approved=false and wait in the queue.
    const { data: athlete, error } = await supabase
      .from('athletes')
      .insert({
        coach_id: DEMO_COACH_ID,
        name,
        email: email.toLowerCase().trim(),
        status: 'invited',
        approved: true,
        invite_token: inviteToken,
        ...(groupId ? { group_id: groupId } : {}),
      })
      .select()
      .single();

    if (error) throw error;

    // Generate invite link
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://madregot-connect.vercel.app'}/join/${inviteToken}`;

    return NextResponse.json({
      athlete,
      inviteLink,
    });
  } catch (error) {
    console.error('Failed to create athlete invitation:', error);
    return NextResponse.json(
      { error: 'Failed to create invitation' },
      { status: 500 }
    );
  }
}

// PUT - Update athlete (group, status, etc.)
//
// Deliberately self-OR-staff rather than staff-only: this same handler serves
// the coach moving someone between groups AND an athlete picking their own group
// on /dashboard/profile. Athletes are limited to their own row and to `groupId`;
// `status` (activate/suspend) and `isAcademy` stay staff-only, or anyone could
// reinstate a suspended account or grant themselves academy access.
export async function PUT(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    const supabase = createServerClient();
    const body = await request.json();
    const { id, groupId, status, isAcademy } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Athlete ID is required' },
        { status: 400 }
      );
    }

    const requested = Object.entries({ groupId, status, isAcademy })
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    const denial = denyAthleteWrite(
      { isStaff: auth.user.isStaff, athleteId: auth.user.athleteId },
      id,
      requested,
    );
    if (denial) {
      const { error, status: code } = athleteWriteError(denial);
      return NextResponse.json({ error }, { status: code });
    }

    const updates: Record<string, any> = {};
    if (groupId !== undefined) updates.group_id = groupId;
    if (status) updates.status = status;
    if (isAcademy !== undefined) updates.is_academy = isAcademy;

    const { data: athlete, error } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .select()
      .single();

    if (error) throw error;

    // Academy enrolment carries two facts the boolean alone doesn't: when they
    // joined the *academy* (created_at is when they joined the club), and that
    // leaving ends the 1:1 pair. Without the second, a coach would keep a phantom
    // trainee on their caseload, and re-enrolling someone months later would
    // silently restore a pairing nobody chose.
    //
    // Kept separate from the update above, and errors only logged, so a database
    // that predates migration 077 still enrols and removes members normally.
    if (isAcademy !== undefined) {
      const today = israelToday();
      if (isAcademy) {
        // Only the first time — re-adding someone doesn't restart their history.
        const { error: stampErr } = await supabase
          .from('athletes')
          .update({ academy_joined_on: today })
          .eq('id', id)
          .is('academy_joined_on', null);
        if (stampErr) console.warn('academy_joined_on not set:', stampErr.message);
      } else {
        const { error: histErr } = await supabase
          .from('academy_coach_history')
          .update({ ended_on: today })
          .eq('athlete_id', id)
          .is('ended_on', null);
        const { error: slotErr } = await supabase
          .from('academy_slots')
          .update({ active_to: today })
          .eq('athlete_id', id)
          .is('active_to', null);
        const { error: unpairErr } = await supabase
          .from('athletes')
          .update({ academy_coach_id: null })
          .eq('id', id);
        const failed = histErr || slotErr || unpairErr;
        if (failed) console.warn('academy pairing not cleared:', failed.message);
      }
    }

    try {
      await syncClubFollows(supabase, id);
    } catch { /* best-effort — never break the athlete update itself */ }

    return NextResponse.json({ athlete });
  } catch (error) {
    console.error('Failed to update athlete:', error);
    return NextResponse.json(
      { error: 'Failed to update athlete' },
      { status: 500 }
    );
  }
}

// DELETE - Remove an athlete
export async function DELETE(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Athlete ID is required' },
        { status: 400 }
      );
    }

    // Never allow deleting a protected account (e.g. the club/admin account).
    const { data: target } = await supabase
      .from('athletes')
      .select('email')
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .maybeSingle();

    if (isProtectedEmail(target?.email)) {
      return NextResponse.json(
        { error: 'This account is protected and cannot be deleted.' },
        { status: 403 }
      );
    }

    const { error } = await supabase
      .from('athletes')
      .delete()
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete athlete:', error);
    return NextResponse.json(
      { error: 'Failed to delete athlete' },
      { status: 500 }
    );
  }
}
