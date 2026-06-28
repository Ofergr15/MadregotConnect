import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';

type UserRole = 'admin' | 'coach' | 'runner' | 'viewer';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groupId?: string | null;
}

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    const { data: coaches, error: coachesError } = await supabase
      .from('coaches')
      .select('id, email, name')
      .order('email');

    if (coachesError) throw coachesError;

    const { data: athletes, error: athletesError } = await supabase
      .from('athletes')
      .select('id, email, name, status, group_id')
      .order('email');

    if (athletesError) throw athletesError;

    const coachUsers: User[] = (coaches || []).map(coach => ({
      id: coach.id,
      email: coach.email,
      name: coach.name,
      role: (coach.id === COACH_ID ? 'admin' : 'coach') as UserRole,
    }));

    const athleteUsers: User[] = (athletes || []).map(athlete => ({
      id: athlete.id,
      email: athlete.email,
      name: athlete.name,
      role: athlete.status === 'active' ? 'runner' : 'viewer',
      groupId: athlete.group_id,
    }));

    const users = [...coachUsers, ...athleteUsers].sort((a, b) =>
      a.email.localeCompare(b.email)
    );

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

    if (!['admin', 'coach', 'runner', 'viewer'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role' },
        { status: 400 }
      );
    }

    const { data: existingCoach } = await supabase
      .from('coaches')
      .select('id, name, email')
      .eq('email', email)
      .maybeSingle();

    const { data: existingAthletes } = await supabase
      .from('athletes')
      .select('id, name, coach_id, group_id')
      .eq('email', email);

    const existingAthlete = existingAthletes?.[0] || null;

    if (!existingCoach && !existingAthlete) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userName = existingCoach?.name || existingAthlete?.name || 'Unknown';

    if (role === 'admin' || role === 'coach') {
      if (!existingCoach) {
        const { error: insertError } = await supabase
          .from('coaches')
          .insert({ email, name: userName });
        if (insertError) throw insertError;
      }

      if (existingAthletes && existingAthletes.length > 0) {
        const { error: deleteError } = await supabase
          .from('athletes')
          .delete()
          .eq('email', email);
        if (deleteError) throw deleteError;
      }

      return NextResponse.json({ success: true, user: { email, role } });
    }

    if (role === 'runner') {
      if (existingCoach) {
        const { error: deleteError } = await supabase
          .from('coaches')
          .delete()
          .eq('id', existingCoach.id);
        if (deleteError) throw deleteError;
      }

      if (existingAthlete) {
        const { error: updateError } = await supabase
          .from('athletes')
          .update({ status: 'active' })
          .eq('id', existingAthlete.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('athletes')
          .insert({ email, name: userName, status: 'active', coach_id: COACH_ID });
        if (insertError) throw insertError;
      }

      return NextResponse.json({ success: true, user: { email, role: 'runner' } });
    }

    if (role === 'viewer') {
      if (existingCoach) {
        const { error: deleteError } = await supabase
          .from('coaches')
          .delete()
          .eq('id', existingCoach.id);
        if (deleteError) throw deleteError;
      }

      if (existingAthlete) {
        const { error: updateError } = await supabase
          .from('athletes')
          .update({ status: 'invited' })
          .eq('id', existingAthlete.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('athletes')
          .insert({ email, name: userName, status: 'invited', coach_id: COACH_ID });
        if (insertError) throw insertError;
      }

      return NextResponse.json({ success: true, user: { email, role: 'viewer' } });
    }

    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update user role:', error);
    return NextResponse.json(
      { error: 'Failed to update user role' },
      { status: 500 }
    );
  }
}
