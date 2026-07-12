import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const lowerEmail = email.toLowerCase().trim();

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
        return NextResponse.json({ role: coachAthlete.role || 'coach', coach });
      }
      // Coach record exists but no matching athlete — treat as new user (was deleted)
    }

    // Check if user is an athlete. Use maybeSingle (not single) so a stray
    // duplicate row can't throw and wrongly force re-registration; if there are
    // multiple, prefer the most complete one (has Garmin, else most recent).
    const { data: activeRows } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth, approved, created_at')
      .eq('email', lowerEmail)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    const athlete = (activeRows || []).sort(
      (a: any, b: any) => (b.garmin_auth ? 1 : 0) - (a.garmin_auth ? 1 : 0)
    )[0];

    if (athlete) {
      if (athlete.approved === false) {
        return NextResponse.json({ pendingApproval: true, missingGarmin: false });
      }
      const hasGarmin = !!athlete.garmin_auth;
      return NextResponse.json({ role: 'runner', athlete: { ...athlete, garmin_auth: undefined, approved: undefined }, hasGarmin });
    }

    // Check invited athletes (need onboarding)
    const { data: invitedAthlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth')
      .eq('email', lowerEmail)
      .eq('status', 'invited')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invitedAthlete) {
      const hasGarmin = !!invitedAthlete.garmin_auth;
      return NextResponse.json({ role: 'runner', athlete: { ...invitedAthlete, garmin_auth: undefined }, hasGarmin, needsOnboarding: !hasGarmin });
    }

    // Check if athlete exists with any status (could be missing garmin/group)
    const { data: anyAthlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth, approved')
      .eq('email', lowerEmail)
      .maybeSingle();

    if (anyAthlete) {
      const hasGarmin = !!anyAthlete.garmin_auth;
      const hasGroup = !!anyAthlete.group_id;
      if (hasGarmin && hasGroup) {
        if (anyAthlete.approved === false) {
          return NextResponse.json({ pendingApproval: true });
        }
        if (anyAthlete.status !== 'active') {
          await supabase.from('athletes').update({ status: 'active' }).eq('id', anyAthlete.id);
        }
        return NextResponse.json({ role: 'runner', athlete: { ...anyAthlete, garmin_auth: undefined, approved: undefined }, hasGarmin });
      }
      // Missing group or garmin — needs onboarding
      return NextResponse.json({
        role: 'runner',
        email: lowerEmail,
        name: anyAthlete.name || name,
        needsOnboarding: true,
        missingGroup: !hasGroup,
        missingGarmin: !hasGarmin,
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
