import { NextResponse, after } from 'next/server';
import { randomBytes } from 'crypto';
import { createServerClient } from '@/lib/supabase/server';
import { APP_URL, COACH_ID, isProtectedEmail } from '@/lib/constants';
import { groupDisplayName, israelToday } from '@/lib/utils';
import { syncClubFollows } from '@/lib/follows/club-sync';
import { authError, requireSession, type SessionUser } from '@/lib/auth-session';
import { athleteWriteError, denyAthleteWrite } from '@/lib/auth/athlete-write-scope';
import { groupChangeDate } from '@/lib/groups/pending-change';
import { afterPackMove, notifyPackScheduled } from '@/lib/groups/pack-move';
import { applyAcademyMembership } from '@/lib/academy/membership-server';
import { mayDeleteAthlete } from '@/lib/auth/delete-athlete-policy';
import { syncApprovedJoiner } from '@/lib/onboarding/approval-sync';

const DEMO_COACH_ID = COACH_ID;

/**
 * Staff gate for creating and deleting athletes. GET requires a session but not
 * staff: the athletes, academy, profile and plan screens all read the roster, and
 * they are all inside the signed-in shell.
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
    // Was fully open. It returns the club's entire roster with email addresses and
    // onboarding state, which is not something an anonymous request should get.
    const auth = await requireSession(request);
    if (!auth.ok) return authError(auth);

    const { searchParams } = new URL(request.url);
    const coachId = searchParams.get('coach_id') || DEMO_COACH_ID;

    const supabase = createServerClient();

    let athletes: any[] | null = null;
    let error: any = null;

    const result = await supabase
      .from('athletes')
      .select(`
        id, name, email, status, created_at, garmin_auth, strava_auth, data_source, strava_enabled, onboarding_status, is_academy, group_id,
        groups!group_id(name)
      `)
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false });

    if (result.error) {
      const fallback = await supabase
        .from('athletes')
        .select(`id, name, email, status, created_at, garmin_auth, group_id, groups!group_id(name)`)
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
      // Staff only — see the same split in GET /api/groups. The non-staff callers
      // of this route (academy, profile) use the id and the name.
      email: auth.user.isStaff ? athlete.email : null,
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
    const { denied, user: caller } = await requireStaff(request);
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

      const inviteLink = `${APP_URL}/join/${inviteToken}`;
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
    const inviteLink = `${APP_URL}/join/${inviteToken}`;

    // Somebody who already asked to join (the public form) is being let in by this
    // invite: close their request and mail them the link, as the entry queue would.
    // Without it they stayed "pending" with nothing sent (Yoav Shachaf, 2026-10-13).
    // A plain invite still hands the link to the coach to pass on, as before.
    const { count: asked } = await supabase.from('signup_requests').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').is('athlete_id', null).ilike('email', email.toLowerCase().trim());
    const sync = asked
      ? await syncApprovedJoiner({ athleteId: athlete.id, approverEmail: caller?.athleteEmail || caller?.email || null, approverIsSuperUser: !!caller?.isSuperUser })
      : null;

    return NextResponse.json({
      athlete,
      inviteLink,
      ...(sync ? { emailed: sync.emailed } : {}),
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

    // A group change waiting for Saturday (#96): the member's own, from the profile,
    // or a coach's "from Saturday" in the pack sheet. A coach's move "from today" is
    // the immediate path below (and that cancels this). `null` cancels.
    if (body.pendingGroupId !== undefined) {
      if (auth.user.athleteId !== id && !auth.user.isStaff) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      const groupId = body.pendingGroupId || null;
      const from = groupId ? groupChangeDate(israelToday()) : null;
      const { error } = await supabase
        .from('athletes')
        .update({ pending_group_id: groupId, pending_group_from: from })
        .eq('id', id)
        .eq('coach_id', DEMO_COACH_ID);
      if (error) throw error;
      // Scheduled by somebody else: the member hears it now, not on Saturday.
      if (groupId && from && auth.user.athleteId !== id) {
        const scheduled = { athleteId: id, groupId, from, byAthleteId: auth.user.athleteId };
        after(() => notifyPackScheduled(supabase, scheduled));
      }
      return NextResponse.json({ pendingGroup: groupId ? { groupId, from } : null });
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
    if (groupId !== undefined) {
      updates.group_id = groupId;
      // A move made here is final: it cancels a change the member scheduled for
      // Saturday (#96). Left in place, the tick applied the pending group on top
      // of the coach's move and quietly undid it.
      updates.pending_group_id = null;
      updates.pending_group_from = null;
    }
    if (status) updates.status = status;
    if (isAcademy !== undefined) updates.is_academy = isAcademy;

    // The pack before the move, for its history row (lib/groups/pack-history.ts).
    let previousGroupId: string | null | undefined;
    if (groupId !== undefined) {
      const { data: before } = await supabase.from('athletes').select('group_id').eq('id', id).maybeSingle();
      previousGroupId = before?.group_id ?? null;
    }

    const { data: athlete, error } = await supabase
      .from('athletes')
      .update(updates)
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .select()
      .single();

    if (error) throw error;

    // A move lands today: runs before it keep the old pack, the watch is checked,
    // and a member moved by someone else is told. After the response — none of it
    // may hold up, or fail, the move itself.
    if (groupId !== undefined && previousGroupId !== undefined && previousGroupId !== (groupId || null)) {
      const move = {
        athleteId: id,
        fromGroupId: previousGroupId,
        toGroupId: groupId || null,
        fromDate: israelToday(),
        by: auth.user.athleteId === id ? 'self' as const : 'coach' as const,
        byAthleteId: auth.user.athleteId,
      };
      after(() => afterPackMove(supabase, move));
    }

    // The joined-on stamp, or the end of the 1:1 pair (see membership-server.ts).
    if (isAcademy !== undefined) await applyAcademyMembership(supabase, id, !!isAcademy);

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
    const { denied, user } = await requireStaff(request);
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
    let { data: target, error: targetError } = await supabase
      .from('athletes')
      .select('email, approved, onboarding_status')
      .eq('id', id)
      .eq('coach_id', DEMO_COACH_ID)
      .maybeSingle();
    if (targetError) {
      // A schema without onboarding_status: the target reads as an ordinary member.
      ({ data: target } = await supabase.from('athletes').select('email, approved').eq('id', id).eq('coach_id', DEMO_COACH_ID).maybeSingle() as any);
    }

    // Deleting a person is a club decision, not any staff session's (launch BL9 / N8a).
    if (!user || !mayDeleteAthlete(user, (target as any) ?? null)) {
      return NextResponse.json({ error: 'Not allowed to delete this athlete' }, { status: 403 });
    }

    if (isProtectedEmail(target?.email)) {
      return NextResponse.json(
        { error: 'This account is protected and cannot be deleted.' },
        { status: 403 }
      );
    }

    // The funnel card that pointed at this person is archived first (launch N16): deleting
    // the athlete left it live on the board, an applicant with no account behind it.
    // Best-effort, and harmless where the funnel tables are not there.
    try {
      await supabase
        .from('academy_candidates')
        .update({ archived_at: new Date().toISOString(), archived_reason: 'נדחה והוסר' })
        .eq('athlete_id', id)
        .is('archived_at', null);
    } catch { /* no funnel */ }

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
