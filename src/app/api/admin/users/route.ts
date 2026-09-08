import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canGrantAdmin } from '@/lib/constants';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isCoreRunner } from '@/lib/core-runner';
import { readMaintenance } from '@/lib/maintenance';
import { isBlockedByMaintenance } from '@/lib/admin/entry-queue';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UserRole = 'admin' | 'coach' | 'runner' | 'core_runner' | 'viewer';

/** Postgres "column does not exist" — migration 091 not pasted in yet. */
const UNDEFINED_COLUMN = '42703';

/**
 * Staff gate on a VERIFIED session. This route used to resolve its caller from
 * the `x-user-email` header, which meant sending one line — `x-user-email:
 * <any coach's address>` — was enough to hand yourself the coach role through
 * PUT, or delete any athlete and all their activities through DELETE. Nothing
 * about the request is trusted now except the JWT.
 */
async function requireStaff(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return { denied, caller };
  if (!caller.isSuperUser && !caller.isStaff) {
    return {
      denied: NextResponse.json({ error: 'Staff access required' }, { status: 403 }),
      caller,
    };
  }
  return { denied: null, caller };
}

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groupId?: string | null;
  onboardingStatus?: string;
  approved?: boolean;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
  createdAt?: string | null;
  /** In the גרעין. Read through isCoreRunner(), so the legacy role counts too. */
  isCoreRunner?: boolean;
  /**
   * Is the maintenance window keeping this person out RIGHT NOW — the same
   * verdict `resolveVerifiedCaller` enforces, resolved here rather than in the
   * browser. Approval is only one of the two doors, so a roster that shows
   * `approved: true` and nothing else is how "I approved them and they still
   * can't get in" happened repeatedly.
   *
   * The allowlist itself deliberately does NOT ship with this: the screen needs
   * the answer, not the list.
   */
  blocked?: boolean;
  /**
   * A watch is CONNECTED, from garmin_auth/strava_auth presence — never
   * `onboarding_status`, which said `garmin_authed` for people whose credential
   * had since been cleared. Presence only; the credentials are encrypted at rest
   * and never leave the server.
   */
  hasWatch?: boolean;
  /**
   * In the academy. Sits beside `isCoreRunner` because the two behave
   * identically as far as reachable pages go: both are FLAGS, not roles, and
   * both only ever ADD pages on top of whatever the role grants (see
   * resolveNavItems). The roster needs it to state what a given member can
   * actually open — without it, two runners with different page lists render
   * identically.
   */
  isAcademy?: boolean;
}

const BASE_COLUMNS =
  'id, email, name, role, group_id, onboarding_status, approved, approved_at, last_seen_at, created_at';

export async function GET(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();

    // is_core_runner is asked for so the roster can show and edit גרעין
    // membership in the same place as the role and the דבוקה. Migrations here are
    // applied by hand, so "091 isn't pasted in yet" is a state a reader can hit —
    // fall back to the base columns rather than 500ing the whole roster. The
    // legacy role value still reads as in, so the list stays correct either way.
    // garmin_auth/strava_auth are read for PRESENCE only — see hasWatch below.
    const CREDENTIALS = 'garmin_auth, strava_auth';
    const withFlag = await supabase
      .from('athletes')
      .select(`${BASE_COLUMNS}, ${CREDENTIALS}, is_core_runner, is_academy`)
      .order('email');

    const { data: athletes, error } =
      withFlag.error?.code === UNDEFINED_COLUMN
        ? await supabase.from('athletes').select(`${BASE_COLUMNS}, ${CREDENTIALS}`).order('email')
        : withFlag;

    if (error) throw error;

    // One read for the whole roster (15 s cached, fails open), not one per row.
    const maintenance = await readMaintenance();

    const users: User[] = ((athletes || []) as any[]).map((a: any) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      role: (a.role || 'runner') as UserRole,
      groupId: a.group_id,
      onboardingStatus: a.onboarding_status || 'active',
      approved: a.approved ?? true,
      approvedAt: a.approved_at,
      lastSeenAt: a.last_seen_at,
      createdAt: a.created_at ?? null,
      isCoreRunner: isCoreRunner(a),
      // Undefined in the column-fallback path above, same as is_core_runner —
      // reads as "not in the academy", which is the safe way to be wrong here
      // (it understates the page list rather than inventing access).
      isAcademy: !!a.is_academy,
      blocked: isBlockedByMaintenance({ id: a.id, email: a.email }, maintenance),
      hasWatch: !!(a.garmin_auth || a.strava_auth),
    }));

    return NextResponse.json({ users, maintenance: maintenance.on });
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const { denied, caller } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const body = await request.json();
    const { email, role } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: 'Email and role are required' },
        { status: 400 }
      );
    }

    if (!['admin', 'coach', 'runner', 'core_runner', 'viewer'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role' },
        { status: 400 }
      );
    }

    const { data: athlete, error: findError } = await supabase
      .from('athletes')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();

    if (findError) throw findError;

    if (!athlete) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Only the designated granter may create or remove admins. This blocks both
    // promoting someone TO admin and demoting an existing admin FROM anyone else.
    const touchesAdmin = role === 'admin' || athlete.role === 'admin';
    if (touchesAdmin && !canGrantAdmin(caller.email)) {
      return NextResponse.json(
        { error: 'Only the club admin account can grant or remove the admin role.' },
        { status: 403 }
      );
    }

    const { error: updateError } = await supabase
      .from('athletes')
      .update({ role })
      .eq('id', athlete.id);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, user: { email, role } });
  } catch (error) {
    console.error('Failed to update user role:', error);
    return NextResponse.json(
      { error: 'Failed to update user role' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { denied } = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    }

    // Get the athlete before deleting
    const { data: athlete } = await supabase
      .from('athletes')
      .select('email, role')
      .eq('id', id)
      .single();

    if (!athlete) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Never delete admin users
    if (athlete.role === 'admin') {
      return NextResponse.json({ error: 'Cannot delete admin users' }, { status: 403 });
    }

    // Delete all related data
    await supabase.from('athlete_activities').delete().eq('athlete_id', id);
    await supabase.from('workout_deliveries').delete().eq('athlete_id', id);

    // If user was a coach, delete their weekly plans too
    const { data: coachRecord } = await supabase
      .from('coaches')
      .select('id')
      .eq('email', athlete.email)
      .maybeSingle();

    if (coachRecord) {
      await supabase.from('weekly_plans').delete().eq('coach_id', coachRecord.id);
      await supabase.from('coaches').delete().eq('id', coachRecord.id);
    }

    // Delete the athlete record
    const { error } = await supabase.from('athletes').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
