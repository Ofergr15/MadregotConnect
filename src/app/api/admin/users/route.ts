import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

type UserRole = 'admin' | 'runner' | 'viewer';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groupId?: string | null;
}

/**
 * GET - List all users with their roles
 *
 * Returns a combined list of coaches (admin role) and athletes (runner/viewer roles).
 * Athletes with status='active' are runners, status='invited' are viewers.
 */
export async function GET(request: Request) {
  try {
    const supabase = createServerClient();

    // Fetch all coaches (admins)
    const { data: coaches, error: coachesError } = await supabase
      .from('coaches')
      .select('id, email, name')
      .order('email');

    if (coachesError) throw coachesError;

    // Fetch all athletes (runners and viewers)
    const { data: athletes, error: athletesError } = await supabase
      .from('athletes')
      .select('id, email, name, status, group_id')
      .order('email');

    if (athletesError) throw athletesError;

    // Transform coaches to user format
    const coachUsers: User[] = (coaches || []).map(coach => ({
      id: coach.id,
      email: coach.email,
      name: coach.name,
      role: 'admin' as UserRole,
    }));

    // Transform athletes to user format
    const athleteUsers: User[] = (athletes || []).map(athlete => ({
      id: athlete.id,
      email: athlete.email,
      name: athlete.name,
      role: athlete.status === 'active' ? 'runner' : 'viewer',
      groupId: athlete.group_id,
    }));

    // Combine and sort by email
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

/**
 * PUT - Update a user's role
 *
 * Body: { email, role } where role is 'admin' | 'runner' | 'viewer'
 *
 * Logic:
 * - Changing to 'admin': add to coaches table (if not exists), remove from athletes
 * - Changing to 'runner': update athletes status to 'active'
 * - Changing to 'viewer': update athletes status to 'invited' (or create if not exists)
 */
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

    if (!['admin', 'runner', 'viewer'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, runner, or viewer' },
        { status: 400 }
      );
    }

    // Find existing user in both tables
    const { data: existingCoach } = await supabase
      .from('coaches')
      .select('id, name')
      .eq('email', email)
      .maybeSingle();

    const { data: existingAthlete } = await supabase
      .from('athletes')
      .select('id, name, coach_id, group_id, invite_token')
      .eq('email', email)
      .maybeSingle();

    if (!existingCoach && !existingAthlete) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userName = existingCoach?.name || existingAthlete?.name || 'Unknown';

    // Handle role change to 'admin'
    if (role === 'admin') {
      // Add to coaches if not already there
      if (!existingCoach) {
        const { error: insertError } = await supabase
          .from('coaches')
          .insert({
            email,
            name: userName,
          });

        if (insertError) throw insertError;
      }

      // Remove from athletes if present
      if (existingAthlete) {
        const { error: deleteError } = await supabase
          .from('athletes')
          .delete()
          .eq('id', existingAthlete.id);

        if (deleteError) throw deleteError;
      }

      return NextResponse.json({
        success: true,
        user: { email, role: 'admin' },
      });
    }

    // Handle role change to 'runner'
    if (role === 'runner') {
      // Remove from coaches if present
      if (existingCoach) {
        const { error: deleteError } = await supabase
          .from('coaches')
          .delete()
          .eq('id', existingCoach.id);

        if (deleteError) throw deleteError;
      }

      // Update athlete status to 'active' or create new athlete
      if (existingAthlete) {
        const { error: updateError } = await supabase
          .from('athletes')
          .update({ status: 'active' })
          .eq('id', existingAthlete.id);

        if (updateError) throw updateError;
      } else {
        // Create new athlete with active status
        const { error: insertError } = await supabase
          .from('athletes')
          .insert({
            email,
            name: userName,
            status: 'active',
            coach_id: null, // Will need to be assigned
          });

        if (insertError) throw insertError;
      }

      return NextResponse.json({
        success: true,
        user: { email, role: 'runner' },
      });
    }

    // Handle role change to 'viewer'
    if (role === 'viewer') {
      // Remove from coaches if present
      if (existingCoach) {
        const { error: deleteError } = await supabase
          .from('coaches')
          .delete()
          .eq('id', existingCoach.id);

        if (deleteError) throw deleteError;
      }

      // Update athlete status to 'invited' or create new athlete
      if (existingAthlete) {
        const { error: updateError } = await supabase
          .from('athletes')
          .update({ status: 'invited' })
          .eq('id', existingAthlete.id);

        if (updateError) throw updateError;
      } else {
        // Create new athlete with invited status
        const { error: insertError } = await supabase
          .from('athletes')
          .insert({
            email,
            name: userName,
            status: 'invited',
            coach_id: null, // Will need to be assigned
          });

        if (insertError) throw insertError;
      }

      return NextResponse.json({
        success: true,
        user: { email, role: 'viewer' },
      });
    }

    return NextResponse.json(
      { error: 'Invalid role' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Failed to update user role:', error);
    return NextResponse.json(
      { error: 'Failed to update user role' },
      { status: 500 }
    );
  }
}
