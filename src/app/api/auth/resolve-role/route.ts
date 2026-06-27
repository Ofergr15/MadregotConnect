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
      .select('id, name, email, group_id, status')
      .eq('email', lowerEmail)
      .eq('status', 'active')
      .single();

    if (athlete) {
      return NextResponse.json({ role: 'runner', athlete });
    }

    // User exists but has no role yet — viewer
    return NextResponse.json({ role: 'viewer', email: lowerEmail, name });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to resolve role' },
      { status: 500 }
    );
  }
}
