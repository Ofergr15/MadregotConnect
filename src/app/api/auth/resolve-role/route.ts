import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const lowerEmail = email.toLowerCase();

    // Check if user is a coach
    const { data: coach } = await supabase
      .from('coaches')
      .select('id, email, name')
      .eq('email', lowerEmail)
      .single();

    if (coach) {
      return NextResponse.json({ role: 'coach', coach });
    }

    // Check if user is an athlete
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth')
      .eq('email', lowerEmail)
      .eq('status', 'active')
      .single();

    if (athlete) {
      const hasGarmin = !!athlete.garmin_auth;
      return NextResponse.json({ role: 'runner', athlete: { ...athlete, garmin_auth: undefined }, hasGarmin });
    }

    // Check invited athletes (need onboarding)
    const { data: invitedAthlete } = await supabase
      .from('athletes')
      .select('id, name, email, group_id, status, garmin_auth')
      .eq('email', lowerEmail)
      .eq('status', 'invited')
      .single();

    if (invitedAthlete) {
      const hasGarmin = !!invitedAthlete.garmin_auth;
      return NextResponse.json({ role: 'runner', athlete: { ...invitedAthlete, garmin_auth: undefined }, hasGarmin, needsOnboarding: !hasGarmin });
    }

    // New user — find the public invite token so they can onboard
    const { data: publicInvite } = await supabase
      .from('athletes')
      .select('invite_token')
      .like('email', 'public-%@invite.madregot.app')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      role: 'viewer',
      email: lowerEmail,
      name,
      joinToken: publicInvite?.invite_token || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to resolve role' },
      { status: 500 }
    );
  }
}
