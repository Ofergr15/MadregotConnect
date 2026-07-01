import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

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

export async function GET() {
  try {
    const supabase = createServerClient();

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
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (findError) throw findError;

    if (!athlete) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    }

    // Delete related activities first
    await supabase.from('athlete_activities').delete().eq('athlete_id', id);

    // Delete the athlete
    const { error } = await supabase.from('athletes').delete().eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
