import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canGrantAdmin } from '@/lib/constants';
import { resolveCallerFromEmailHeader, isStaffRole } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UserRole = 'admin' | 'coach' | 'runner' | 'core_runner' | 'viewer';

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
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    const caller = await resolveCallerFromEmailHeader(request, supabase);
    if (!caller.isSuperUser && !isStaffRole(caller.athlete?.role)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

    const { data: athletes, error } = await supabase
      .from('athletes')
      .select('id, email, name, role, group_id, onboarding_status, approved, approved_at, last_seen_at')
      .order('email');

    if (error) throw error;

    const users: User[] = (athletes || []).map((a: any) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      role: (a.role || 'runner') as UserRole,
      groupId: a.group_id,
      onboardingStatus: a.onboarding_status || 'active',
      approved: a.approved ?? true,
      approvedAt: a.approved_at,
      lastSeenAt: a.last_seen_at,
    }));

    return NextResponse.json({ users });
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
    const supabase = createServerClient();
    const body = await request.json();
    const { email, role, actorEmail } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: 'Email and role are required' },
        { status: 400 }
      );
    }

    // Any role change requires the actor to be staff (or the super user) —
    // previously only changes touching 'admin' were gated at all, so any
    // signed-up user could hand themselves 'coach'/'core_runner'/'viewer'.
    const caller = await resolveCallerFromEmailHeader(request, supabase);
    if (!caller.isSuperUser && !isStaffRole(caller.athlete?.role)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
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
    if (touchesAdmin && !canGrantAdmin(actorEmail)) {
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
    const supabase = createServerClient();

    const caller = await resolveCallerFromEmailHeader(request, supabase);
    if (!caller.isSuperUser && !isStaffRole(caller.athlete?.role)) {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 });
    }

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
